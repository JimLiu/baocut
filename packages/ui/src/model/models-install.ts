import { live, type JobRecord, type ModelBundleStatus, type ModelInstallPlan, type ModelInstallProgress } from '@baocut/protocol';
import { MODELS_ENDPOINT_ENV, TOOLS_ENDPOINT_ENV, hostOf, kindOfComponent, planKinds, type SourceKind } from './download-source.ts';
import {
  bundleCategory,
  downloadBytes,
  hasOwnFiles,
  isBundleInstalled,
  LOCAL_PROVIDER,
  missingParts,
  partLabel,
  sharedComponents,
} from './models-local.ts';
import { shortenDir } from './models-dir.ts';
import { fmtSize, type Remedy } from './task-facts.ts';
import { packageView } from './semantic-package.ts';
import { TASK_VIEW_COPY } from '../copy.ts';
import { M, type ModelsInstallMessages } from './models-install-copy.ts';
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
  /** 已装好、这次不动。 */
  keep: boolean;
  /** 这一部分从哪个基址下载（Runtime 给的；旧 Runtime 不给时 null）；不动的也是 null。 */
  source: string | null;
}

/** 按来源种类分的一组（设计稿 download-dialog.jsx `Group`）：每组一个来源选择器。 */
export interface PlanGroup {
  kind: SourceKind;
  lines: PlanLine[];
  /** 这一组有要下载的部分（没有时不给选择器，写「这一组已下好」）。 */
  downloading: boolean;
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
  /** 按来源种类分组的 `lines`（顺序同 `SOURCE_KINDS`，没有的种类不出组）。 */
  groups: PlanGroup[];
}

/** 计划 → 确认对话框里的几行话。 */
export function installPlanView(plan: Omit<ModelInstallPlan, 'bundleId'>): InstallPlanView {
  const lines: PlanLine[] = plan.components.map((c) => ({
    key: `${c.component}:${c.repo}`,
    label: `${partLabel(c.component)} · ${c.repo}`,
    value: c.action === 'keep' ? M.lineKeep : c.bytes !== null ? M.lineSize(fmtSize(c.bytes), c.files.length) : M.lineUnknown(c.files.length),
    keep: c.action === 'keep',
    source: c.action === 'keep' ? null : (c.source ?? null),
  }));
  const exact = plan.downloadBytes !== null;
  const size = exact ? M.planSize(fmtSize(plan.confirmBytes)) : M.planSizeEstimate(fmtSize(plan.confirmBytes));
  // 放在模型目录以外时，可用空间是那个文件夹所在的磁盘。
  const away = !!plan.dir && plan.dir.path !== plan.dir.modelsDir;
  const noSpace =
    plan.availableBytes !== null && plan.availableBytes < plan.confirmBytes
      ? (away ? M.noSpaceFolder : M.noSpace)(fmtSize(plan.confirmBytes), fmtSize(plan.availableBytes))
      : null;
  return {
    upToDate: plan.upToDate,
    size,
    amount: exact ? fmtSize(plan.confirmBytes) : M.amountEstimate(fmtSize(plan.confirmBytes)),
    resumed: plan.resumedBytes > 0 ? M.resumed(fmtSize(plan.resumedBytes)) : null,
    space: plan.availableBytes !== null ? M.space(fmtSize(plan.availableBytes)) : null,
    noSpace,
    source: plan.source,
    lines,
    groups: planKinds(plan).map((kind) => {
      const own = plan.components.map((c, i) => [c, lines[i]!] as const).filter(([c]) => kindOfComponent(c) === kind);
      return { kind, lines: own.map(([, l]) => l), downloading: own.some(([c]) => c.action === 'download') };
    }),
  };
}

// ---- 存放位置（设计稿 download-dialog.jsx `Where`） ----

export const INSTALL_FOLDER_COPY: ModelsInstallMessages['folder'] = live(() => M.folder);

export interface InstallFolderView {
  /** 这次的模型仓库放在哪（完整路径，界面里缩短显示）。 */
  path: string;
  /** 就是模型目录时标「模型目录」，模型目录由环境变量锁定时标「环境变量」；别处不标。 */
  chip: 'models-dir' | 'env' | null;
  /** 能换文件夹：模型目录没被环境变量锁定，也不是接着暂停的下载。 */
  canChange: boolean;
  /** 这次选了模型目录以外的文件夹：给「改回模型目录」。 */
  picked: boolean;
  /** 文件夹不在或不能写：不让确认。 */
  problem: { title: string; text: string } | null;
  /** 位置下面的说明（几句连成一段）；没有时 null。 */
  note: string | null;
}

/**
 * 计划 → 存放位置一块（架构设计 §6.3）。只管模型仓库：这次没有模型仓库要下载（都已装好，或只下发布页组件——它们装在
 * 工具目录）、旧 Runtime 不给 `dir` 时 null。修复不换位置，调用方不显示。
 */
export function installFolderView(plan: Pick<ModelInstallPlan, 'components' | 'dir'>): InstallFolderView | null {
  const dir = plan.dir;
  const downloading = plan.components.filter((c) => c.action === 'download');
  if (!dir || !downloading.some((c) => kindOfComponent(c) === 'models')) return null;
  const home = dir.path === dir.modelsDir;
  const picked = !home && !dir.fixed;
  const notes = [
    ...(dir.locked ? [M.folder.envNote] : []),
    ...(dir.fixed ? [M.folder.fixedNote] : []),
    ...(picked ? [M.folder.pickedNote] : []),
    ...(downloading.some((c) => kindOfComponent(c) === 'tools') ? [M.folder.toolsNote] : []),
  ];
  return {
    path: dir.path,
    chip: dir.locked ? 'env' : home ? 'models-dir' : null,
    canChange: !dir.locked && !dir.fixed,
    picked,
    problem:
      dir.problem === 'missing'
        ? { title: M.folder.missingTitle, text: M.folder.missingText }
        : dir.problem === 'not-writable'
          ? { title: M.folder.notWritableTitle, text: M.folder.notWritableText }
          : null,
    note: notes.length ? M.sentences(notes) : null,
  };
}

/**
 * 模型行上那一句：组件下载时放在了模型目录以外（`location`）的文件夹；都在模型目录里时 null。几个组件在不同的地方时报告
 * 第一个（必需的组件优先）。
 */
export function bundleLocation(bundle: Pick<ModelBundleStatus, 'components'>): string | null {
  const located = (bundle.components ?? []).filter((c) => c.location);
  return (located.find((c) => !c.optional) ?? located[0])?.location ?? null;
}

/** 模型行上的「存放在 … · 不在模型目录」；都在模型目录里时 null。 */
export function storedAtText(bundle: Pick<ModelBundleStatus, 'components'>): string | null {
  const at = bundleLocation(bundle);
  return at ? M.storedAt(shortenDir(at, 44)) : null;
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

// ---- 就地下载（设计稿 tool-tts.jsx、image-gen.jsx、panel-aitools.jsx、panel-dub-setup.jsx 的「下载 {size}」） ----

/** 这只模型包能不能就地下载：还没装好，这台电脑也跑得了。装好了的、跑不了的（`unsupported`、`worker-missing`）不算。 */
export function canDownload(bundle: Pick<ModelBundleStatus, 'state' | 'reason' | 'components'>): boolean {
  return !isBundleInstalled(bundle) && bundle.reason !== 'unsupported' && bundle.reason !== 'worker-missing';
}

/** 本机的这只模型能就地下载时它的模型包；云端、节点、装好了的、这台电脑跑不了的为 null。 */
export function downloadableBundle(
  bundles: readonly ModelBundleStatus[],
  ref: { providerId: string; modelId: string } | null,
): ModelBundleStatus | null {
  if (!ref || ref.providerId !== LOCAL_PROVIDER) return null;
  const bundle = bundles.find((b) => b.bundleId === ref.modelId);
  return bundle && canDownload(bundle) ? bundle : null;
}

/**
 * 配音要分离背景声、本机又没有能用的分离模型时就地下载哪一只：按 ID 排第一只能下载的（Runtime 挑分离默认值也按 ID 排）。
 * 都下载不了（这台电脑跑不了）时 null。
 */
export function separationDownload(bundles: readonly ModelBundleStatus[]): ModelBundleStatus | null {
  return (
    bundles
      .filter((b) => b.capability === 'separate')
      .sort((a, b) => a.bundleId.localeCompare(b.bundleId))
      .find(canDownload) ?? null
  );
}

/**
 * 就地下载走哪种安装（与设置页同一个判断，设计稿 settings-local.jsx 的 `half`）：这只模型包自己的文件已在盘上（权重在、缺公共组件，
 * 或下到一半、权重已经落地）时是补齐——只下载缺的，不再问许可；否则是下载。公共组件按它那一类的模型包算（`hasOwnFiles`）。
 */
export function inlineInstallMode(bundle: ModelBundleStatus, bundles: readonly ModelBundleStatus[]): 'install' | 'complete' {
  const category = bundleCategory(bundle);
  return hasOwnFiles(bundle, category ? sharedComponents(bundles, category) : []) ? 'complete' : 'install';
}

export interface DownloadView {
  /** `idle` 还没开始，`paused` 停在一半（接着下），`running` 正在下（排队、下载、校验）。 */
  state: 'idle' | 'paused' | 'running';
  /** 要下载多少：下载任务的总量，没有时按缺的组件算（`downloadBytes`，与设置页同一个数）；都不知道时 null。 */
  size: string | null;
  /** 正在下时的百分比；总量未知、排队或校验中时 null。 */
  percent: number | null;
}

/** 就地下载那一处此刻的样子：按钮上写多大，下载中写进度。 */
export function downloadView(bundle: Pick<ModelBundleStatus, 'install' | 'estimatedBytes' | 'components'>): DownloadView {
  const install = bundle.install;
  const total = install?.totalBytes || downloadBytes(bundle);
  const size = total ? fmtSize(total) : null;
  if (!install) return { state: 'idle', size, percent: null };
  const progress = installProgressView(install);
  return progress.running ? { state: 'running', size, percent: progress.percent } : { state: 'paused', size, percent: null };
}

// ---- 失败与补救 ----

export interface Problem {
  /** Runtime 的原话。 */
  message: string;
  /** 怎么办；认不得的错误码用 Runtime 给的 `remedy`，都没有时 null。 */
  remedy: string | null;
  /** 下载时哪一部分没下成（`details.component`）与它连的基址（`details.source`）；不是某一部分的失败时没有。 */
  part?: { component: string; source: string | null };
}

function num(details: unknown, key: string): number | null {
  const v = (details as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(details: unknown, key: string): string | null {
  const v = (details as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'string' && v ? v : null;
}

/** 按错误码说清楚怎么办（模型包的安装、修复与删除）。下载失败带着哪一部分时一并记下。 */
export function modelProblem(code: string | null, message: string, details: unknown): Problem {
  const problem = codeProblem(code, message, details);
  const component = str(details, 'component');
  return component ? { ...problem, part: { component, source: str(details, 'source') } } : problem;
}

function codeProblem(code: string | null, message: string, details: unknown): Problem {
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
      // GitHub 发布页的部分走工具来源，环境变量也是工具的那个。
      return { message, remedy: M.remedySource(str(details, 'origin') === 'github-release' ? TOOLS_ENDPOINT_ENV : MODELS_ENDPOINT_ENV) };
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

/**
 * 安装失败那一行（设计稿 model-download-sources.js `failLine`）：哪一部分没下成、连的哪里，再是原话与补救。`kept`：别的部分已经下好、
 * 留在盘上（这只模型包还缺组件），补齐时只下缺的，可以先换来源。
 */
export function installFailureText(problem: Problem, kept: boolean): string {
  const text = problemText(problem);
  if (!problem.part) return text;
  const name = partLabel(problem.part.component);
  const head = problem.part.source ? M.partFailedFrom(name, hostOf(problem.part.source)) : M.partFailed(name);
  return M.sentences([head, text, ...(kept ? [M.partKept] : [])]);
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

/**
 * 任务页上失败的安装任务去哪儿补（设计稿 model-task-facts.js `installFailure`）：语义搜索包去 设置 › 语义索引，别的去它那一类的
 * 能力页。按到了那一页看到的按钮写：那一页给「补齐」的（下好的部分留着）是「去补齐」，否则「去重新下载」。任务是旧的，按模型包
 * 现在的样子判断：找不到、已经装好、正在重新装、这台电脑跑不了的不给去处。
 */
export function installRemedy(job: Pick<JobRecord, 'kind' | 'state' | 'bundleId'>, bundles: readonly ModelBundleStatus[]): Remedy | null {
  if (job.kind !== 'modelInstall' || job.state !== 'failed') return null;
  const bundle = bundles.find((b) => b.bundleId === job.bundleId);
  if (!bundle || !canDownload(bundle) || (bundle.install && bundle.install.state !== 'paused')) return null;
  const copy = TASK_VIEW_COPY;
  const remedy = (kept: boolean, target: Remedy['target']): Remedy =>
    kept
      ? { label: copy.remedyComplete, target, hint: copy.completeHint }
      : { label: copy.remedyRedownload, target, hint: copy.redownloadHint };
  // 语义搜索的文字与多模态两个模型包合成一个包（semantic-package.ts）：设置页上缺一个时给「补齐」。
  if (bundle.capability === 'embed') {
    return remedy(packageView(bundles.filter((b) => b.capability === 'embed')).state === 'partial', { tab: 'settings', section: 'semantic' });
  }
  const category = bundleCategory(bundle);
  return category ? remedy(inlineInstallMode(bundle, bundles) === 'complete', { tab: 'models', category }) : null;
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
  /** 下载（自己的文件不在盘上，且没在装、没暂停）。 */
  install: boolean;
  /** 继续下载（暂停着）。 */
  resume: boolean;
  /** 停下（有任务在跑）。 */
  stop: boolean;
  /** 丢掉已下载的部分（暂停着）。 */
  discard: boolean;
  /** 补齐：自己的文件在盘上、还缺组件（`missingParts`），只下载缺的那几件（没在装、没暂停）。 */
  complete: boolean;
  /** 修复：盘上的逐个文件校验一遍、只重下坏的与缺的。能不能检查见 model-check.ts 的 `checkRoute`。 */
  repair: boolean;
  /** 删除：自己的文件在盘上、没有在装的。 */
  remove: boolean;
}

/**
 * 一行模型包能做什么（设计稿 settings-local.jsx）。`ownFiles`：模型包自己的文件在不在盘上（models-local.ts `hasOwnFiles`，要整类的
 * 公共组件才算得出；默认按装好没有算）。在盘上、还缺组件的（`half`）给「补齐」不给「下载」，照样能修复、删除。
 */
export function bundleActions(bundle: ModelBundleStatus, ownFiles = isBundleInstalled(bundle)): BundleActions {
  const installing = !!bundle.install && bundle.install.state !== 'paused';
  const paused = bundle.install?.state === 'paused';
  const cannotRun = bundle.reason === 'unsupported' || bundle.reason === 'worker-missing';
  return {
    install: !ownFiles && !bundle.install && bundle.reason !== 'unsupported',
    complete: !bundle.install && missingParts(bundle, ownFiles).length > 0,
    resume: paused && bundle.reason !== 'unsupported',
    stop: installing,
    discard: paused,
    repair: ownFiles && !installing && !cannotRun,
    remove: ownFiles && !installing,
  };
}
