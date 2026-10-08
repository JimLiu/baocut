import fs from 'node:fs/promises';
import path from 'node:path';
import { isTerminal, type JobManager, type TaskRun, TaskFailure, canonicalJson, sha256Hex } from '@baocut/jobs';
import type { Logger } from '@baocut/harness';
import {
  RpcError,
  nowIso,
  refOf,
  withRef,
  type ExternalToolConsent,
  type ExternalToolConsentVia,
  type ExternalToolInstallResult,
  type ExternalToolSource,
  type ExternalToolStatus,
  type ExternalToolUpdatePlan,
  type ExternalToolUpdateResult,
  type JobRecord,
  type JobSubmitter,
  type Localized,
  type MessageRef,
} from '@baocut/protocol';
import { readJson, writeJsonAtomic } from '@baocut/runtime-storage';
import { ToolDownloadError, downloadToolFile, type ToolDownloadOptions } from './tool-download.ts';
import { BUILTIN_TOOL_MANIFESTS, compareVersions, platformKey, toolOffer, type ToolManifest } from './tool-manifests.ts';
import { envValue, findOnPath, isExecutableFile, runVersionProbe, windowsScriptKind } from './tool-probe.ts';
import { CommandOutput, runCommand } from './tool-command.ts';
import { exitCodeText, toolUpdatePlan, updateSucceeded } from './tool-update-plan.ts';
import { RcExternalTools } from '@baocut/protocol/messages/runtime-core';
import { remedyOf, taskFailure } from '../localized.ts';

/**
 * 受管外部工具的状态与动作（架构设计 §12.9）：探测、同意、指定路径、下载与删除受管副本。
 *
 * - 解析顺序：环境变量（只有 ffmpeg 的 `BAOCUT_FFMPEG`）→ 用户指定的路径 → 受管副本 → 系统 PATH（Runtime 的工具环境，
 *   即登录 shell 的 PATH；测试注入一个空目录）。用户指定的路径不能运行时报告为不可用，不悄悄换成别的。
 * - 同意与用户路径、受管副本的登记存在 `<home>/store/external-tools.json`；受管副本在 `<home>/tools/<工具>/<版本>/`，
 *   下载中的文件在 `<home>/tools/.staging/`（取消时保留，下次续传）。
 * - 下载是一个任务（`kind: 'toolInstall'`）：提交前查严格离线、清单与同意，任务里下载、核对 sha256 与大小、设可执行位、
 *   原子地改名发布，再执行一次 `--version` 确认能运行。
 * - 系统里自己装的那一份按原安装方式更新（`tool-update-plan.ts` 判断办法）：也是一个任务（`kind: 'toolUpdate'`），提交前
 *   要调用方交回用户确认过的那条命令；任务里不经 shell 执行，输出逐段写进任务记录的 `command`，结束后重新探测。
 *   不提权：要管理员权限的只给命令。更新进行中用它的流程拒绝启动（`TOOL_UPDATING`），反过来有流程在用时不更新。
 */

export const TOOL_INSTALL_PIPELINE_USERS = ['link-import'] as const;

const STORE_VERSION = 1;
/** 一次只装或更新一个工具（文件不大，避免并发写同一个目录）。 */
const INSTALL_QUEUE = { key: 'tool-install', concurrency: 1 };
const PROGRESS_INTERVAL_MS = 250;
/** 更新命令的时限：Homebrew 可能先更新自己、从源码装的还要编译。 */
const UPDATE_TIMEOUT_MS = 15 * 60_000;
/** 任务记录里留的输出末尾，与结果产物里留的全文上限（字符）。 */
const UPDATE_OUTPUT_TAIL = 32_000;
const UPDATE_OUTPUT_FULL = 1_000_000;
/** 执行更新命令时补上的环境：不要颜色与提示、不问问题、Python 不缓冲输出。 */
const UPDATE_ENV: NodeJS.ProcessEnv = {
  HOMEBREW_NO_ENV_HINTS: '1',
  HOMEBREW_NO_COLOR: '1',
  PIP_DISABLE_PIP_VERSION_CHECK: '1',
  PIP_NO_INPUT: '1',
  PIP_PROGRESS_BAR: 'off',
  PYTHONUNBUFFERED: '1',
  NO_COLOR: '1',
};

interface ToolRecord {
  userPath: string | null;
  consent: ExternalToolConsent | null;
  managed: { version: string; sha256: string; installedAt: string } | null;
}

interface StoreFile {
  version: number;
  tools: Record<string, ToolRecord>;
}

export interface ExternalToolSettings {
  /** 设置 `tools.downloadEndpoint`。 */
  downloadEndpoint: string | null;
  offlineStrict: boolean;
}

export interface ExternalToolServiceOptions {
  /** `<home>/tools`。 */
  toolsDir: string;
  /** `<home>/store/external-tools.json`。 */
  storeFile: string;
  jobs: JobManager;
  log: Logger;
  /** 探测与执行工具用的环境：`PATH` 是系统 PATH 的搜索路径。 */
  env: () => Promise<NodeJS.ProcessEnv>;
  settings: () => ExternalToolSettings;
  /** 读环境变量覆盖（`BAOCUT_TOOLS_ENDPOINT`、`BAOCUT_FFMPEG`）的地方；默认 `process.env`。 */
  overrides?: NodeJS.ProcessEnv;
  /** 测试注入的清单（例如带已知摘要的假工具）。 */
  manifests?: readonly ToolManifest[];
  platform?: string;
  download?: ToolDownloadOptions;
}

/** 流程要用一个工具时拿到的：可执行文件、版本与来源。 */
export interface ResolvedTool {
  name: string;
  command: string;
  version: string;
  source: ExternalToolSource;
  env: NodeJS.ProcessEnv;
}

/**
 * 按一次探测的状态判断工具此刻能不能用（流程启动时与工具目录共用）：正在更新、没有安装、不能运行、版本过旧、要同意而没有
 * 同意时给出错误码（`TOOL_UPDATING`、`TOOL_NOT_INSTALLED`、`TOOL_UNAVAILABLE`、`TOOL_OUTDATED`、`TOOL_CONSENT_REQUIRED`）、
 * 说明与补救；能用时 null。
 */
export function toolUseProblem(status: ExternalToolStatus): { code: string; message: Localized; remedy: Localized | string } | null {
  // 状态里存的原因与补救带着引用：嵌进这里的文案，读者按自己的语言展开。
  const reason = withRef(status.reason ?? '', status.reasonRef);
  const remedy = withRef(status.remedy ?? '', status.remedyRef);
  if (status.updateJobId) {
    return {
      code: 'TOOL_UPDATING',
      message: RcExternalTools.toolUpdating({ label: status.label }),
      remedy: RcExternalTools.waitForUpdate({ jobId: status.updateJobId }),
    };
  }
  if (status.state === 'missing') return { code: 'TOOL_NOT_INSTALLED', message: RcExternalTools.toolNotInstalled({ label: status.label }), remedy };
  if (status.state === 'unavailable') {
    return { code: 'TOOL_UNAVAILABLE', message: RcExternalTools.toolCannotRun({ label: status.label, reason }), remedy };
  }
  if (status.state === 'outdated') {
    return { code: 'TOOL_OUTDATED', message: RcExternalTools.toolOutdated({ label: status.label, reason }), remedy };
  }
  if (status.consentRequired && status.consent?.state !== 'granted') {
    return {
      code: 'TOOL_CONSENT_REQUIRED',
      message:
        status.consent?.state === 'revoked'
          ? RcExternalTools.consentRevoked({ label: status.label })
          : RcExternalTools.consentRequired({ label: status.label }),
      remedy: RcExternalTools.consentRemedy({ name: status.name }),
    };
  }
  return null;
}

/** 问题里的补救放进 `details` 或 `ToolProblem`：文字连同引用（存下的文字没有引用时只给文字）。 */
export function problemRemedy(remedy: Localized | string): { remedy: string; remedyRef?: MessageRef } {
  return typeof remedy === 'string' ? { remedy } : remedyOf(remedy);
}

/** 状态里的原因与补救：文字连同引用（界面按自己的语言重新生成）。 */
function said(reason: Localized, remedy: Localized): Pick<ExternalToolStatus, 'reason' | 'reasonRef' | 'remedy' | 'remedyRef'> {
  return { reason: reason.text, reasonRef: refOf(reason), ...remedyOf(remedy) };
}

export class ExternalToolService {
  readonly #options: ExternalToolServiceOptions;
  readonly #manifests: Map<string, ToolManifest>;
  readonly #platform: string;
  readonly #status = new Map<string, ExternalToolStatus>();
  #store: StoreFile | null = null;
  #writes: Promise<void> = Promise.resolve();

  constructor(options: ExternalToolServiceOptions) {
    this.#options = options;
    this.#manifests = new Map((options.manifests ?? BUILTIN_TOOL_MANIFESTS).map((m) => [m.name, m]));
    this.#platform = options.platform ?? platformKey();
  }

  get #overrides(): NodeJS.ProcessEnv {
    return this.#options.overrides ?? process.env;
  }

  /** 上次探测的结果；还没探测过的先探测。 */
  async list(): Promise<ExternalToolStatus[]> {
    for (const name of this.#manifests.keys()) if (!this.#status.has(name)) await this.#detectOne(name);
    return [...this.#manifests.keys()].map((name) => this.#decorate(this.#status.get(name)!));
  }

  async detect(name?: string): Promise<ExternalToolStatus[]> {
    if (name !== undefined) await this.#detectOne(this.#manifest(name).name);
    else for (const tool of this.#manifests.keys()) await this.#detectOne(tool);
    return this.list();
  }

  /** 一个工具此刻的状态（重新探测）。 */
  async status(name: string): Promise<ExternalToolStatus> {
    return this.#decorate(await this.#detectOne(this.#manifest(name).name));
  }

  /** 记下或撤回同意。 */
  async consent(params: { name: string; grant: boolean; via?: ExternalToolConsentVia }): Promise<{ tool: ExternalToolStatus }> {
    const manifest = this.#managedManifest(params.name);
    const consent: ExternalToolConsent = { state: params.grant ? 'granted' : 'revoked', at: nowIso(), via: params.via ?? 'app' };
    await this.#update(manifest.name, (record) => ({ ...record, consent }));
    this.#options.log.info(params.grant ? 'External tool consent granted' : 'External tool consent withdrawn', { tool: manifest.name, via: consent.via });
    return { tool: await this.status(manifest.name) };
  }

  /** 用户同意过、此刻还有效。 */
  async consented(name: string): Promise<boolean> {
    const manifest = this.#manifest(name);
    if (!manifest.consentRequired) return true;
    return (await this.#record(name)).consent?.state === 'granted';
  }

  async setPath(params: { name: string; path: string | null }): Promise<{ tool: ExternalToolStatus }> {
    const manifest = this.#managedManifest(params.name);
    if (params.path !== null) {
      if (!(await isExecutableFile(params.path))) {
        throw new RpcError('invalid-request', RcExternalTools.notExecutable({ path: params.path }), { code: 'TOOL_UNAVAILABLE', tool: manifest.name });
      }
      if (this.#platform.startsWith('win32') && windowsScriptKind(params.path)) {
        throw new RpcError('invalid-request', RcExternalTools.notWindowsProgram({ path: params.path }), {
          code: 'TOOL_UNAVAILABLE',
          tool: manifest.name,
        });
      }
      const probe = await runVersionProbe(params.path, manifest.versionArgs, await this.#options.env());
      const version = probe.ok ? manifest.parseVersion(probe.output) : null;
      if (!probe.ok || !version) {
        throw new RpcError(
          'invalid-request',
          RcExternalTools.cannotRunAs({ path: params.path, label: manifest.label, reason: probe.ok ? RcExternalTools.noVersion() : probe.reason }), {
          code: 'TOOL_UNAVAILABLE',
          tool: manifest.name,
        });
      }
    }
    await this.#update(manifest.name, (record) => ({ ...record, userPath: params.path }));
    return { tool: await this.status(manifest.name) };
  }

  /** 删除受管副本。 */
  async remove(params: { name: string }): Promise<{ tool: ExternalToolStatus }> {
    const manifest = this.#managedManifest(params.name);
    const busy = this.#busyJobs(manifest.name);
    if (busy.length > 0) {
      throw new RpcError('conflict', RcExternalTools.toolInUse({ label: manifest.label }), { code: 'TOOL_IN_USE', tool: manifest.name, jobIds: busy });
    }
    await this.#update(manifest.name, (record) => ({ ...record, managed: null }));
    await fs.rm(path.join(this.#options.toolsDir, manifest.name), { recursive: true, force: true });
    await fs.rm(this.#stagingFile(manifest), { force: true });
    this.#options.log.info('Removed managed tool', { tool: manifest.name });
    return { tool: await this.status(manifest.name) };
  }

  /**
   * 下载受管副本：两步。没有 `consent: true` 时以 `TOOL_CONSENT_REQUIRED` 拒绝并交出来源、版本、大小与许可；给了就记下同意、
   * 提交任务。
   */
  async install(
    params: { name: string; consent?: boolean; via?: ExternalToolConsentVia; commandId?: string },
    submitter: JobSubmitter,
  ): Promise<ExternalToolInstallResult> {
    const manifest = this.#manifest(params.name);
    if (!manifest.release) {
      throw new RpcError('invalid-request', RcExternalTools.notDownloadedByBaocut({ label: manifest.label, remedy: manifest.missingRemedy }), {
        code: 'TOOL_NOT_MANAGED',
        tool: manifest.name,
      });
    }
    if (params.commandId) {
      const existing = this.#options.jobs.jobForCommand(params.commandId);
      if (existing) return { tool: await this.status(manifest.name), jobId: existing };
    }
    const active = this.#activeInstall(manifest.name);
    if (active) return { tool: await this.status(manifest.name), jobId: active.jobId };
    const endpoint = this.#endpoint();
    const offer = toolOffer(manifest, endpoint, this.#platform)!;
    if (params.consent !== true) {
      throw new RpcError('conflict', RcExternalTools.downloadNeedsConsent({ label: manifest.label }), {
        code: 'TOOL_CONSENT_REQUIRED',
        tool: manifest.name,
        offer,
      });
    }
    if (this.#options.settings().offlineStrict) {
      throw new RpcError('conflict', RcExternalTools.offlineStrictNoDownload(), { code: 'OFFLINE_STRICT', tool: manifest.name });
    }
    const asset = manifest.release.assets[this.#platform];
    if (!asset || asset.sha256 === null || offer.url === null) {
      throw new RpcError('conflict', RcExternalTools.cannotDownload({ label: manifest.label, reason: withRef(offer.blockedReason ?? '', offer.blockedReasonRef) }), {
        code: 'TOOL_MANIFEST_INCOMPLETE',
        tool: manifest.name,
        offer,
        ...remedyOf(RcExternalTools.manifestIncompleteRemedy({ label: manifest.label })),
      });
    }
    await this.consent({ name: manifest.name, grant: true, via: params.via ?? 'app' });
    const spec = { task: 'toolInstall' as const, tool: manifest.name, version: manifest.release.version, sha256: asset.sha256 };
    const hash = `sha256:${sha256Hex(canonicalJson(spec))}`;
    const url = offer.url;
    const expected = { size: asset.size, sha256: asset.sha256, fileName: asset.fileName };
    const version = manifest.release.version;
    const { jobId } = this.#options.jobs.submitTask(
      {
        kind: 'toolInstall',
        spec,
        videoId: null,
        contentHash: hash,
        inputHash: hash,
        providerId: manifest.name,
        modelId: version,
        ...(params.commandId ? { commandId: params.commandId } : {}),
        queue: INSTALL_QUEUE,
        run: (run) => this.#runInstall(run, manifest, version, url, expected),
      },
      submitter,
    );
    this.#options.log.info('Submitted external tool install', { tool: manifest.name, version, jobId });
    return { tool: await this.status(manifest.name), jobId };
  }

  /**
   * 按原安装方式更新系统里的那一份（`status.update`）：两步。没给 `command`、或与此刻的办法不同时以
   * `TOOL_UPDATE_CONFIRM_REQUIRED` 拒绝并交出办法（完整命令）；交回用户确认过的同一条命令才提交任务。
   */
  async update(params: { name: string; command?: string; commandId?: string }, submitter: JobSubmitter): Promise<ExternalToolUpdateResult> {
    const manifest = this.#manifest(params.name);
    if (params.commandId) {
      const existing = this.#options.jobs.jobForCommand(params.commandId);
      if (existing) return { tool: await this.status(manifest.name), jobId: existing };
    }
    const active = this.#activeUpdate(manifest.name);
    if (active) return { tool: await this.status(manifest.name), jobId: active.jobId };
    const status = await this.status(manifest.name);
    const plan = status.update;
    if (!plan) {
      const managed = status.source === 'managed';
      throw new RpcError(
        'conflict',
        managed
          ? RcExternalTools.updateManagedCopy({ label: manifest.label })
          : status.path && (status.state === 'installed' || status.state === 'outdated')
            ? RcExternalTools.updateUnknownInstall({ path: status.path })
            : RcExternalTools.updateNoRunnable({ label: manifest.label }),
        {
          code: 'TOOL_UPDATE_UNSUPPORTED',
          tool: manifest.name,
          ...remedyOf(managed ? RcExternalTools.updateManagedRemedy() : RcExternalTools.updateManualRemedy()),
        },
      );
    }
    if (!plan.runnable) {
      throw new RpcError('conflict', plan.reason ? withRef(plan.reason, plan.reasonRef) : RcExternalTools.cannotUpdateFor({ label: manifest.label }), {
        code: 'TOOL_UPDATE_MANUAL',
        tool: manifest.name,
        update: plan,
        ...remedyOf(RcExternalTools.runInTerminalRemedy({ command: plan.command })),
      });
    }
    if (params.command !== plan.command) {
      throw new RpcError(
        'conflict',
        params.command === undefined
          ? RcExternalTools.confirmUpdateCommand({ label: manifest.label, command: plan.command })
          : RcExternalTools.updateCommandChanged({ label: manifest.label, command: plan.command }),
        { code: 'TOOL_UPDATE_CONFIRM_REQUIRED', tool: manifest.name, update: plan },
      );
    }
    if (this.#options.settings().offlineStrict) {
      throw new RpcError('conflict', RcExternalTools.offlineStrictNoUpdate(), { code: 'OFFLINE_STRICT', tool: manifest.name });
    }
    const busy = this.#busyJobs(manifest.name);
    if (busy.length > 0) {
      throw new RpcError('conflict', RcExternalTools.toolInUse({ label: manifest.label }), { code: 'TOOL_IN_USE', tool: manifest.name, jobIds: busy });
    }
    const spec = { task: 'toolUpdate' as const, tool: manifest.name, method: plan.method, argv: plan.argv };
    const hash = `sha256:${sha256Hex(canonicalJson(spec))}`;
    const before = status.version;
    const { jobId } = this.#options.jobs.submitTask(
      {
        kind: 'toolUpdate',
        spec,
        videoId: null,
        contentHash: hash,
        inputHash: hash,
        providerId: manifest.name,
        modelId: before ?? 'unknown',
        ...(params.commandId ? { commandId: params.commandId } : {}),
        queue: INSTALL_QUEUE,
        run: (run) => this.#runUpdate(run, manifest, plan, before),
      },
      submitter,
    );
    this.#options.log.info('Submitted external tool update', { tool: manifest.name, method: plan.method, command: plan.command, jobId });
    return { tool: await this.status(manifest.name), jobId };
  }

  /**
   * 流程要用一个工具：重新探测，要已安装、版本够、同意有效、不在更新，否则以 `conflict` 拒绝（`TOOL_NOT_INSTALLED`、
   * `TOOL_OUTDATED`、`TOOL_UNAVAILABLE`、`TOOL_CONSENT_REQUIRED`、`TOOL_UPDATING`），`details.remedy` 说怎么补救。
   */
  async resolveForUse(name: string): Promise<ResolvedTool> {
    const status = await this.status(name);
    const problem = toolUseProblem(status);
    if (problem) {
      throw new RpcError('conflict', problem.message, {
        code: problem.code,
        tool: status.name,
        state: status.state,
        ...problemRemedy(problem.remedy),
        offer: status.offer,
      });
    }
    return { name: status.name, command: status.path!, version: status.version!, source: status.source!, env: await this.#options.env() };
  }

  // ---- 探测 ----

  async #detectOne(name: string): Promise<ExternalToolStatus> {
    const manifest = this.#manifest(name);
    const record = await this.#record(name);
    const env = await this.#options.env();
    const base = this.#baseStatus(manifest, record);
    const platform = this.#platform.split('-')[0] as NodeJS.Platform;
    const lookup = (command: string) => findOnPath(command, env.PATH ?? '', platform, envValue(env, 'PATHEXT') ?? null);
    const candidates: Array<{ file: string | null; source: ExternalToolSource; strict: boolean; label: string | Localized }> = [];
    const fromEnv = manifest.envVar ? this.#overrides[manifest.envVar] : undefined;
    if (fromEnv) {
      const file = path.isAbsolute(fromEnv) ? fromEnv : await lookup(fromEnv);
      candidates.push({ file, source: 'env', strict: true, label: RcExternalTools.sourceEnvVar({ name: manifest.envVar! }) });
    }
    if (record.userPath) candidates.push({ file: record.userPath, source: 'user', strict: true, label: RcExternalTools.sourceUserPath() });
    if (record.managed) {
      const file = this.#managedFile(manifest, record.managed.version);
      if (await isExecutableFile(file)) candidates.push({ file, source: 'managed', strict: true, label: RcExternalTools.sourceManaged() });
    }
    candidates.push({ file: await lookup(manifest.command), source: 'system', strict: false, label: 'PATH' });
    let status: ExternalToolStatus = { ...base, state: 'missing', ...said(RcExternalTools.commandNotFound({ command: manifest.command }), manifest.missingRemedy) };
    for (const candidate of candidates) {
      if (!candidate.file) {
        if (candidate.strict) {
          status = {
            ...base,
            state: 'unavailable',
            ...said(RcExternalTools.commandNotFoundIn({ where: candidate.label, command: manifest.command }), manifest.missingRemedy),
          };
          break;
        }
        continue;
      }
      if (!(await isExecutableFile(candidate.file))) {
        status = {
          ...base,
          state: 'unavailable',
          path: candidate.file,
          source: candidate.source,
          ...said(RcExternalTools.sourceNotExecutable({ where: candidate.label }), manifest.missingRemedy),
        };
        break;
      }
      // Windows：.cmd、.bat 要经 cmd.exe 才能跑，BaoCut 不经命令行解释器执行工具（参数里有链接）。
      const script = platform === 'win32' ? windowsScriptKind(candidate.file) : null;
      if (script) {
        status = {
          ...base,
          state: 'unavailable',
          path: candidate.file,
          source: candidate.source,
          ...said(
            RcExternalTools.sourceIsScript({ where: candidate.label, batch: script === 'batch' }),
            RcExternalTools.setExePathRemedy({ command: manifest.command, canInstall: manifest.release !== null }),
          ),
        };
        break;
      }
      const probe = await runVersionProbe(candidate.file, manifest.versionArgs, env);
      const version = probe.ok ? manifest.parseVersion(probe.output) : null;
      if (!probe.ok || !version) {
        status = {
          ...base,
          state: 'unavailable',
          path: candidate.file,
          source: candidate.source,
          ...said(probe.ok ? RcExternalTools.noVersion() : probe.reason, manifest.missingRemedy),
        };
        break;
      }
      const outdated = manifest.minVersion !== null && compareVersions(version, manifest.minVersion) < 0;
      status = {
        ...base,
        state: outdated ? 'outdated' : 'installed',
        path: candidate.file,
        version,
        source: candidate.source,
        ...(outdated
          ? said(
              RcExternalTools.belowMinVersion({ version, min: manifest.minVersion! }),
              manifest.release
                ? RcExternalTools.installOrUpdateRemedy({ version: manifest.release.version, label: manifest.label })
                : RcExternalTools.updateTool({ label: manifest.label }),
            )
          : {}),
      };
      break;
    }
    if (manifest.update && status.path && (status.state === 'installed' || status.state === 'outdated') && (status.source === 'system' || status.source === 'user')) {
      const update = await toolUpdatePlan(status.path, manifest.label, manifest.update, env.PATH ?? '', platform, env).catch(() => null);
      status = { ...status, update };
    }
    this.#status.set(name, status);
    return status;
  }

  #baseStatus(manifest: ToolManifest, record: ToolRecord): ExternalToolStatus {
    return {
      name: manifest.name,
      label: manifest.label,
      purpose: manifest.purpose.text,
      purposeRef: refOf(manifest.purpose),
      state: 'missing',
      reason: null,
      path: null,
      version: null,
      source: null,
      minVersion: manifest.minVersion,
      installable: manifest.release !== null,
      offer: null,
      consentRequired: manifest.consentRequired,
      consent: record.consent,
      managed: record.managed
        ? {
            version: record.managed.version,
            path: this.#managedFile(manifest, record.managed.version),
            installedAt: record.managed.installedAt,
          }
        : null,
      userPath: record.userPath,
      installJobId: null,
      update: null,
      updateJobId: null,
      platform: this.#platform.split('-')[0]!,
      remedy: null,
    };
  }

  /** 交出之前补上随时会变的部分：下载说明（来源随设置变）、正在进行的安装。 */
  #decorate(status: ExternalToolStatus): ExternalToolStatus {
    const manifest = this.#manifest(status.name);
    let offer = null;
    try {
      offer = toolOffer(manifest, this.#endpoint(), this.#platform);
    } catch {
      offer = toolOffer(manifest, null, this.#platform);
    }
    return {
      ...status,
      offer,
      installJobId: this.#activeInstall(status.name)?.jobId ?? null,
      updateJobId: this.#activeUpdate(status.name)?.jobId ?? null,
    };
  }

  // ---- 安装任务 ----

  async #runInstall(
    run: TaskRun,
    manifest: ToolManifest,
    version: string,
    url: string,
    expected: { size: number | null; sha256: string; fileName: string },
  ): Promise<NonNullable<JobRecord['result']>> {
    const part = this.#stagingFile(manifest);
    await fs.mkdir(path.dirname(part), { recursive: true });
    let last = 0;
    const total = expected.size;
    run.phase('downloading', { done: 0, total, unit: 'bytes' });
    try {
      await downloadToolFile(
        url,
        part,
        expected,
        {
          signal: run.signal,
          onBytes: (received) => {
            const now = Date.now();
            if (now - last < PROGRESS_INTERVAL_MS) return;
            last = now;
            run.phase('downloading', { done: received, total, unit: 'bytes' });
          },
        },
        this.#options.download,
      );
    } catch (error) {
      if (run.signal.aborted) throw error;
      if (error instanceof ToolDownloadError) {
        this.#options.log.warn('External tool download failed', { tool: manifest.name, code: error.code });
        throw Object.assign(new TaskFailure(error.code, error.message, { ...error.details, remedy: error.remedy, remedyRef: error.remedyRef }), {
          messageRef: error.messageRef,
        });
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw taskFailure('TOOL_DOWNLOAD_NO_SPACE', RcExternalTools.diskFull(), {});
      }
      throw error;
    }
    run.phase('publishing', null);
    await fs.chmod(part, 0o755);
    const final = this.#managedFile(manifest, version);
    const dir = path.dirname(final);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(part, final);
    run.phase('validating', null);
    const probe = await runVersionProbe(final, manifest.versionArgs, await this.#options.env());
    const actual = probe.ok ? manifest.parseVersion(probe.output) : null;
    if (!probe.ok || !actual) {
      await fs.rm(dir, { recursive: true, force: true });
      throw taskFailure('TOOL_UNAVAILABLE', RcExternalTools.downloadedCannotRun({ label: manifest.label, reason: probe.ok ? RcExternalTools.noVersion() : probe.reason }), {
        tool: manifest.name,
      });
    }
    const installedAt = nowIso();
    await this.#update(manifest.name, (record) => ({ ...record, managed: { version, sha256: expected.sha256, installedAt } }));
    // 旧版本的受管副本：新的装好之后删掉。
    for (const entry of await fs.readdir(path.join(this.#options.toolsDir, manifest.name)).catch(() => [] as string[])) {
      if (entry !== version) await fs.rm(path.join(this.#options.toolsDir, manifest.name, entry), { recursive: true, force: true });
    }
    await this.#detectOne(manifest.name);
    const { artifactId } = await this.#options.jobs.artifacts.put(
      Buffer.from(
        canonicalJson({
          schema: 'baocut.tool-install/1',
          tool: manifest.name,
          version,
          reportedVersion: actual,
          fileName: expected.fileName,
          sha256: expected.sha256,
          installedAt,
        }),
      ),
      'json',
    );
    this.#options.log.info('External tool installed', { tool: manifest.name, version, jobId: run.jobId });
    return { documentId: null, artifactId };
  }

  // ---- 更新任务 ----

  /**
   * 执行更新命令：输出按 250 ms 节流写进任务记录（`command`），结束后不管结果都重新探测（停下来的命令也可能改了一部分）。
   * 退出码不是 0（winget 没有可升级的版本时的 0x8A15002B 算成功）、超时、不能启动时失败（`TOOL_UPDATE_FAILED`），
   * 原来的那一份由安装它的工具负责，BaoCut 不动。
   */
  async #runUpdate(
    run: TaskRun,
    manifest: ToolManifest,
    plan: ExternalToolUpdatePlan,
    before: string | null,
  ): Promise<NonNullable<JobRecord['result']>> {
    const tail = new CommandOutput(UPDATE_OUTPUT_TAIL);
    const full = new CommandOutput(UPDATE_OUTPUT_FULL);
    const report = (exitCode: number | null) =>
      run.command({ line: plan.command, output: tail.text, lines: tail.lines, truncated: tail.truncated, exitCode });
    // 节流：间隔内到的输出攒着，间隔一到补发一次（命令接着安静很久时也看得到最后几行）。
    let last = 0;
    let pending: NodeJS.Timeout | null = null;
    const flush = () => {
      pending = null;
      last = Date.now();
      report(null);
    };
    run.phase('downloading', null);
    report(null);
    this.#options.log.info('Running external tool update', { tool: manifest.name, method: plan.method, command: plan.command, jobId: run.jobId });
    const outcome = await runCommand(plan.argv, {
      env: { ...(await this.#options.env()), ...UPDATE_ENV },
      signal: run.signal,
      timeoutMs: UPDATE_TIMEOUT_MS,
      onOutput: (chunk) => {
        tail.push(chunk);
        full.push(chunk);
        if (pending) return;
        const wait = PROGRESS_INTERVAL_MS - (Date.now() - last);
        if (wait <= 0) flush();
        else pending = setTimeout(flush, wait);
      },
    });
    if (pending) clearTimeout(pending);
    const exitCode = outcome.kind === 'exited' ? outcome.exitCode : null;
    report(exitCode);
    run.phase('validating', null);
    const after = await this.#detectOne(manifest.name);
    const fields = {
      tool: manifest.name,
      method: plan.method,
      outcome: outcome.kind,
      exitCode,
      before,
      after: after.version,
      jobId: run.jobId,
      output: tail.text.slice(-8_000),
    };
    if (outcome.kind === 'aborted') {
      this.#options.log.info('External tool update stopped', fields);
      throw new Error(RcExternalTools.updateStopped().text);
    }
    const { artifactId } = await this.#options.jobs.artifacts.put(
      Buffer.from(
        canonicalJson({
          schema: 'baocut.tool-update/1',
          tool: manifest.name,
          method: plan.method,
          command: plan.command,
          outcome: outcome.kind,
          exitCode,
          versionBefore: before,
          versionAfter: after.version,
          output: full.text,
          truncated: full.truncated,
        }),
      ),
      'json',
    );
    const result = { documentId: null, artifactId };
    if (updateSucceeded(plan.method, exitCode)) {
      this.#options.log.info('External tool updated', fields);
      return result;
    }
    this.#options.log.warn('External tool update failed', fields);
    const message =
      outcome.kind === 'exited'
        ? RcExternalTools.updateExited({ code: exitCodeText(outcome.exitCode) })
        : outcome.kind === 'timed-out'
          ? RcExternalTools.updateTimedOut({ minutes: UPDATE_TIMEOUT_MS / 60_000 })
          : outcome.kind === 'signalled'
            ? RcExternalTools.updateSignalled({ signal: String(outcome.signal) })
            : RcExternalTools.updateCannotStart({ reason: outcome.reason });
    throw taskFailure(
      'TOOL_UPDATE_FAILED',
      message,
      { tool: manifest.name, method: plan.method, exitCode, ...remedyOf(RcExternalTools.updateFailedRemedy({ command: plan.command })) },
      result,
    );
  }

  // ---- 记录 ----

  #manifest(name: string): ToolManifest {
    const manifest = this.#manifests.get(name);
    if (!manifest) throw new RpcError('not-found', RcExternalTools.unknownTool({ name }), { code: 'TOOL_UNKNOWN', tool: name });
    return manifest;
  }

  /** 由登记表解析路径、要同意的工具；ffmpeg 照旧由 `BAOCUT_FFMPEG` 与 PATH 决定，只报告状态。 */
  #managedManifest(name: string): ToolManifest {
    const manifest = this.#manifest(name);
    if (!manifest.release) {
      throw new RpcError('invalid-request', RcExternalTools.notManaged({ label: manifest.label, remedy: manifest.missingRemedy }), {
        code: 'TOOL_NOT_MANAGED',
        tool: manifest.name,
      });
    }
    return manifest;
  }

  #managedFile(manifest: ToolManifest, version: string): string {
    const exe = this.#platform.startsWith('win32') ? `${manifest.command}.exe` : manifest.command;
    return path.join(this.#options.toolsDir, manifest.name, version, exe);
  }

  #stagingFile(manifest: ToolManifest): string {
    return path.join(this.#options.toolsDir, '.staging', `${manifest.name}-${manifest.release?.version ?? 'none'}.part`);
  }

  /** 下载来源：环境变量 `BAOCUT_TOOLS_ENDPOINT` 优先于设置。不合法时 `invalid-request`。 */
  #endpoint(): string | null {
    const fromEnv = this.#overrides.BAOCUT_TOOLS_ENDPOINT?.trim();
    const value = fromEnv || this.#options.settings().downloadEndpoint;
    if (!value) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new RpcError('invalid-request', RcExternalTools.endpointInvalid(), { code: 'TOOL_DOWNLOAD_SOURCE' });
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) {
      throw new RpcError('invalid-request', RcExternalTools.endpointBadForm(), {
        code: 'TOOL_DOWNLOAD_SOURCE',
      });
    }
    return value;
  }

  #activeInstall(name: string): JobRecord | null {
    return this.#options.jobs.list().find((j) => j.kind === 'toolInstall' && j.providerId === name && !isTerminal(j.state)) ?? null;
  }

  #activeUpdate(name: string): JobRecord | null {
    return this.#options.jobs.list().find((j) => j.kind === 'toolUpdate' && j.providerId === name && !isTerminal(j.state)) ?? null;
  }

  /** 正在安装或更新它、或正在用它的流程。 */
  #busyJobs(name: string): string[] {
    return this.#options.jobs
      .list()
      .filter(
        (j) =>
          !isTerminal(j.state) &&
          ((j.kind === 'toolInstall' && j.providerId === name) ||
            (j.kind === 'toolUpdate' && j.providerId === name) ||
            (j.kind === 'pipeline' && (TOOL_INSTALL_PIPELINE_USERS as readonly string[]).includes(j.pipeline?.name ?? ''))),
      )
      .map((j) => j.jobId);
  }

  async #load(): Promise<StoreFile> {
    if (this.#store) return this.#store;
    const raw = await readJson<StoreFile>(this.#options.storeFile).catch(() => null);
    this.#store =
      raw && raw.version === STORE_VERSION && raw.tools && typeof raw.tools === 'object' ? raw : { version: STORE_VERSION, tools: {} };
    return this.#store;
  }

  async #record(name: string): Promise<ToolRecord> {
    const store = await this.#load();
    return store.tools[name] ?? { userPath: null, consent: null, managed: null };
  }

  async #update(name: string, change: (record: ToolRecord) => ToolRecord): Promise<void> {
    const write = this.#writes.then(async () => {
      const store = await this.#load();
      store.tools[name] = change(store.tools[name] ?? { userPath: null, consent: null, managed: null });
      await writeJsonAtomic(this.#options.storeFile, store, { mode: 0o600 });
    });
    this.#writes = write.catch(() => {});
    await write;
  }
}
