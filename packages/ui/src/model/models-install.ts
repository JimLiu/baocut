import type { JobRecord, ModelBundleStatus, ModelInstallPlan, ModelInstallProgress } from '@baocut/protocol';
import { isBundleInstalled } from './models-local.ts';
import { fmtSize } from './task-facts.ts';
import { M } from './models-install-copy.ts';
import { jobErrorText, remedyText } from './localized-text.ts';

/**
 * 本地模型包的安装管理（架构设计 §6.3；设计稿 settings-local.jsx、model-local-models.js）：
 * 安装与修复的两步确认（先看计划、再交回 `confirmBytes`）、下载进度、删除估算，以及各种失败给人看的补救。
 * 检查（`models.test`）的状态与说法在 model-check.ts。
 * 数字都来自 Runtime：总字节数未知时不伪造百分比，估计值写明是估计。
 */

// ---- 确认对话框 ----

export interface PlanLine {
  key: string;
  /** `asr · Qwen/Qwen3-ASR-0.6B` */
  label: string;
  /** `412 MB`、`大小未知`、`已装好，不动` */
  value: string;
}

export interface InstallPlanView {
  /** 已经齐全、没有要下载的。 */
  upToDate: boolean;
  /** 「要下载 1.2 GB」；有文件大小未知时「约 1.2 GB（有文件大小未知，按登记的估计）」。 */
  size: string;
  /** 按钮上的量：「1.2 GB」或「约 1.2 GB」。 */
  amount: string;
  /** 上次留下、这次接着用的部分；没有时 null。 */
  resumed: string | null;
  /** 磁盘可用空间；查不到时 null。 */
  space: string | null;
  /** 可用空间明显不够（不含已经收到的部分）：先清理再下载。 */
  noSpace: string | null;
  source: string;
  lines: PlanLine[];
}

/** 计划 → 确认对话框里的几行话。 */
export function installPlanView(plan: ModelInstallPlan): InstallPlanView {
  const exact = plan.downloadBytes !== null;
  const size = exact ? M.planSize(fmtSize(plan.confirmBytes)) : M.planSizeEstimate(fmtSize(plan.confirmBytes));
  const noSpace =
    plan.availableBytes !== null && plan.availableBytes < plan.confirmBytes
      ? M.noSpace(fmtSize(plan.confirmBytes), fmtSize(plan.availableBytes))
      : null;
  return {
    upToDate: plan.upToDate,
    size,
    amount: exact ? fmtSize(plan.confirmBytes) : M.amountEstimate(fmtSize(plan.confirmBytes)),
    resumed: plan.resumedBytes > 0 ? M.resumed(fmtSize(plan.resumedBytes)) : null,
    space: plan.availableBytes !== null ? M.space(fmtSize(plan.availableBytes)) : null,
    noSpace,
    source: plan.source,
    lines: plan.components.map((c) => ({
      key: `${c.component}:${c.repo}`,
      label: `${c.component} · ${c.repo}`,
      value: c.action === 'keep' ? M.lineKeep : c.bytes !== null ? M.lineSize(fmtSize(c.bytes), c.files.length) : M.lineUnknown(c.files.length),
    })),
  };
}

// ---- 进度 ----

export interface InstallProgressView {
  state: ModelInstallProgress['state'];
  /** 「正在下载 120 MB / 1.2 GB」「已暂停 · 留着 300 MB」 */
  label: string;
  /** 0–100；总字节数未知、排队或校验中时 null（进度条显示为不确定）。 */
  percent: number | null;
  /** 有任务在跑（排队、下载、校验）：可以停下。 */
  running: boolean;
}

export function installProgressView(install: ModelInstallProgress): InstallProgressView {
  const { receivedBytes: got, totalBytes: total } = install;
  const amount = total !== null ? `${fmtSize(got)} / ${fmtSize(total)}` : fmtSize(got);
  const percent = total !== null && total > 0 ? Math.min(100, Math.floor((got / total) * 100)) : null;
  switch (install.state) {
    case 'queued':
      return { state: 'queued', label: M.queued, percent: null, running: true };
    case 'downloading':
      return { state: 'downloading', label: total !== null ? M.downloading(amount) : M.downloadingUnknown(amount), percent, running: true };
    case 'verifying':
      return { state: 'verifying', label: M.verifying, percent: null, running: true };
    case 'paused':
      return {
        state: 'paused',
        label: got > 0 ? M.pausedKept(amount) : M.paused,
        percent,
        running: false,
      };
  }
}

// ---- 失败与补救 ----

export interface Problem {
  /** Runtime 的原话。 */
  message: string;
  /** 怎么办；认不得的错误码用 Runtime 给的 `remedy`，都没有时 null。 */
  remedy: string | null;
}

function num(details: unknown, key: string): number | null {
  const v = (details as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(details: unknown, key: string): string | null {
  const v = (details as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'string' && v ? v : null;
}

/** 按错误码说清楚怎么办（模型包的安装、修复与删除）。 */
export function modelProblem(code: string | null, message: string, details: unknown): Problem {
  switch (code) {
    case 'MODEL_DOWNLOAD_NO_SPACE': {
      const need = num(details, 'requiredBytes');
      const have = num(details, 'availableBytes');
      const known = need !== null && have !== null;
      return { message, remedy: M.remedyNoSpace(known ? fmtSize(need) : null, known ? fmtSize(have) : null) };
    }
    case 'MODEL_DOWNLOAD_NETWORK':
      return { message, remedy: M.remedyNetwork };
    case 'MODEL_DOWNLOAD_INTEGRITY':
      return { message, remedy: M.remedyIntegrity };
    case 'MODEL_DOWNLOAD_SOURCE':
      return { message, remedy: M.remedySource };
    case 'MODEL_MANIFEST_INCOMPLETE':
      return { message, remedy: M.remedyManifest };
    case 'OFFLINE_STRICT':
      return { message, remedy: M.remedyOffline };
    case 'MODEL_INSTALL_SIZE_CHANGED':
      return { message, remedy: M.remedySizeChanged };
    case 'MODEL_IN_USE':
      return { message, remedy: M.remedyInUse };
    case 'MODEL_UNAVAILABLE':
      return { message, remedy: M.remedyUnavailable };
    case 'MODEL_INSTALL_FAILED':
      return { message, remedy: M.remedyInstallFailed };
    default:
      return { message, remedy: remedyText(details) };
  }
}

/** RPC 被拒（`RpcError`，错误码在 `details.code`）。 */
export function rpcProblem(error: unknown): Problem {
  const message = error instanceof Error ? error.message : String(error);
  const details = (error as { details?: unknown } | null)?.details;
  return modelProblem(str(details, 'code'), message, details);
}

/** 一条失败的任务。 */
export function jobProblem(job: Pick<JobRecord, 'error'>): Problem | null {
  if (!job.error) return null;
  return modelProblem(job.error.code, jobErrorText(job.error), job.error.details);
}

export function problemText(problem: Problem): string {
  return problem.remedy ? M.problemText(problem.message, problem.remedy) : problem.message;
}

// ---- 每一行的安装任务 ----

/** 这个模型包最近一次某类任务（按创建时间）。 */
export function latestBundleJob(jobs: readonly JobRecord[], bundleId: string, kind: 'modelInstall' | 'modelTest'): JobRecord | null {
  let latest: JobRecord | null = null;
  for (const job of jobs) {
    if (job.kind !== kind || job.bundleId !== bundleId) continue;
    if (!latest || job.createdAt > latest.createdAt) latest = job;
  }
  return latest;
}

/** 安装：最近一次安装或修复任务失败了、现在也没在装时，失败的原因与补救（取消的、被打断的不算失败）。 */
export function installFailure(bundle: ModelBundleStatus, jobs: readonly JobRecord[]): Problem | null {
  if (bundle.install && bundle.install.state !== 'paused') return null;
  const job = latestBundleJob(jobs, bundle.bundleId, 'modelInstall');
  if (!job || job.state !== 'failed') return null;
  return jobProblem(job);
}

// ---- 删除 ----

export interface RemovalEstimate {
  /** 会腾出的字节数（只算已装好、没有别的已装模型包在用的组件）；不知道组件时 null。 */
  frees: number | null;
  /** 还有别的已装模型包在用、会保留的组件。 */
  kept: { repo: string; usedBy: string[] }[];
}

/** 删除前的估算：与 Runtime 的规则一致——别的已装模型包也用到的组件保留。 */
export function removalEstimate(bundle: ModelBundleStatus, bundles: readonly ModelBundleStatus[]): RemovalEstimate {
  if (!bundle.components?.length) return { frees: null, kept: [] };
  const installed = new Set(bundles.filter((b) => b.bundleId !== bundle.bundleId && b.state !== 'not-installed').map((b) => b.bundleId));
  let frees = 0;
  const kept: RemovalEstimate['kept'] = [];
  for (const c of bundle.components) {
    const usedBy = c.sharedWith.filter((id) => installed.has(id));
    if (usedBy.length) kept.push({ repo: c.repo, usedBy });
    else if (c.state === 'installed' && c.bytes !== null) frees += c.bytes;
  }
  return { frees, kept };
}

/** 删除确认的正文。 */
export function removalBody(estimate: RemovalEstimate): string {
  const frees = estimate.frees !== null && estimate.frees > 0 ? fmtSize(estimate.frees) : null;
  return M.removalBody(estimate.frees === null, frees, estimate.kept);
}

/** 删完之后的提示：Runtime 实际删了什么、留了什么。 */
export function removedToast(bundleId: string, result: { removed: string[]; kept: { repo: string; usedBy: string[] }[] }): string {
  const kept = result.kept.filter((k) => k.usedBy.length > 0);
  return kept.length ? M.removedKept(bundleId, kept.map((k) => k.repo)) : M.removed(bundleId);
}

// ---- 每行能做什么 ----

export interface BundleActions {
  /** 下载（没装齐，且没在装、没暂停）。 */
  install: boolean;
  /** 继续下载（暂停着）。 */
  resume: boolean;
  /** 停下（有任务在跑）。 */
  stop: boolean;
  /** 丢掉已下载的部分（暂停着）。 */
  discard: boolean;
  /** 修复：装好的逐个文件校验一遍、只重下坏的。能不能检查见 model-check.ts 的 `checkRoute`。 */
  repair: boolean;
  /** 删除：有装好的东西、没有在装的。 */
  remove: boolean;
}

export function bundleActions(bundle: ModelBundleStatus): BundleActions {
  const installing = !!bundle.install && bundle.install.state !== 'paused';
  const paused = bundle.install?.state === 'paused';
  const installed = isBundleInstalled(bundle);
  const hasFiles = installed || !!bundle.components?.some((c) => c.state === 'installed');
  const cannotRun = bundle.reason === 'unsupported' || bundle.reason === 'worker-missing';
  return {
    install: !installed && !bundle.install && bundle.reason !== 'unsupported',
    resume: paused && bundle.reason !== 'unsupported',
    stop: installing,
    discard: paused,
    repair: installed && !installing && !cannotRun,
    remove: hasFiles && !installing,
  };
}
