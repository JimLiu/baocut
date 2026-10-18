import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '@baocut/harness';
import {
  RpcError,
  nowIso,
  refOf,
  type ExternalToolStatus,
  type Id,
  type Localized,
  type Project,
  type ProjectGitCommitRecord,
  type ProjectGitCommitResult,
  type ProjectGitRepoState,
  type ProjectGitStatus,
} from '@baocut/protocol';
import { RcGit, RcRuntime } from '@baocut/protocol/messages/runtime-core';
import { GIT } from '../external-tools/tool-manifests.ts';
import { toolUseProblem, type ExternalToolService } from '../external-tools/external-tool-service.ts';
import type { VideoService } from '../videos/video-service.ts';
import { hostPath } from '../videos/host-path.ts';
import { remedyOf } from '../localized.ts';
import { GitRunError, GitRunner, gitErrorDetail } from './git-command.ts';
import { commitProject, type CommitOutcome } from './git-commit.ts';
import { initRefusal } from './git-init.ts';
import { LocalConfigGate, type LocalConfigCheck } from './git-local-config.ts';
import { ensureInfoBlocks, exists, findRepo, gitPaths, repoState, type GitRepo } from './git-repo.ts';

/**
 * 项目的 git 桥（版本记录设计 §5、架构设计 §5.12）：状态、「提交到 git」、自动提交、初始化与允许本地过滤器。
 *
 * - git 来自受管外部工具的登记表（`git`，只检测不下载）；每次调用都带 §5.4 的安全参数（`git-command.ts`）。
 * - 打开项目时写 `info/exclude` 与 `info/attributes` 的块（§5.2）；没有 git 时只写普通的 `.git` 目录。
 * - 同一个项目的提交排队，一次一个。提交失败只记日志并留在状态里（`lastError`），自动提交从不让编辑、智能体回合或任务失败。
 * - 自动提交（`versions.git.autoCommit`）：项目里的视频最后一次改动之后安静满 5 分钟、项目的视频都关掉了、退出 BaoCut 时各提交一次。
 *   设置在触发时读。仓库被占用（`index.lock`）时推迟到下一个 5 分钟。
 * - 状态与最后一次提交、失败只在这次运行期间记在内存里；项目主题还不推送 git 状态（界面按需调 `projects.git.status`）。
 */

export interface ProjectGitSettings {
  autoCommit: boolean;
  maxFileMiB: number;
}

export interface ProjectGitServiceOptions {
  log: Logger;
  tools: Pick<ExternalToolService, 'status'>;
  /** 运行 git 的环境（登录 shell 的 PATH）。 */
  env: () => Promise<NodeJS.ProcessEnv>;
  /** `<home>/git`：钩子用的空目录 `hooks/`、提交说明 `messages/`。 */
  dir: string;
  /** `<home>/store/git-local-config.json`。 */
  storeFile: string;
  projects: () => readonly Project[];
  videos: Pick<VideoService, 'flushProjectSnapshots' | 'onChange' | 'onClosed' | 'onProjectOpened' | 'openProjectVideoCount'>;
  settings: () => ProjectGitSettings;
  /** 自动提交前要安静多久（默认 5 分钟）。 */
  quietMs?: number;
  /** 遇到 `index.lock` 时重试几次、每次等多久（默认 5 次 × 2 秒）。 */
  lockRetries?: number;
  lockDelayMs?: number;
  platform?: NodeJS.Platform;
  /** 测试注入：主目录（初始化的拒绝名单）。 */
  home?: string;
}

const QUIET_MS = 5 * 60_000;
const LOCK_RETRIES = 5;
const LOCK_DELAY_MS = 2_000;
/** 退出时的提交：锁最多再试一次，整体不超过这么久。 */
const EXIT_BUDGET_MS = 30_000;
/** 找 git 的结果缓存多久（每次状态都探测一遍版本太费）。 */
const TOOL_CACHE_MS = 30_000;

type Lookup =
  | { kind: 'unavailable'; tool: ExternalToolStatus; message: Localized; remedy: Localized | string }
  | { kind: 'not-repo'; runner: GitRunner; version: string; refusal: Awaited<ReturnType<typeof initRefusal>> }
  | { kind: 'error'; runner: GitRunner; version: string; detail: string }
  | {
      kind: 'repo';
      runner: GitRunner;
      version: string;
      repo: GitRepo;
      gate: LocalConfigCheck;
      state: ProjectGitRepoState | null;
      branch: string | null;
      locked: boolean;
    };

interface ProjectRecord {
  lastCommit: ProjectGitCommitRecord | null;
  lastError: ProjectGitStatus['lastError'];
  /** 上次自动提交之后有过改动。 */
  dirty: boolean;
  timer: NodeJS.Timeout | null;
}

/** 状态的投影：Web 不给本机路径与本地配置的条目。 */
export interface StatusView {
  web?: boolean;
}

export class ProjectGitService {
  readonly #options: ProjectGitServiceOptions;
  readonly #log: Logger;
  readonly #gate: LocalConfigGate;
  readonly #hooksDir: string;
  readonly #records = new Map<Id, ProjectRecord>();
  /** 每个项目的提交排队。 */
  readonly #queues = new Map<Id, Promise<unknown>>();
  readonly #unsubscribe: Array<() => void> = [];
  /** 这次运行里已经写过 `info/*` 块的项目（第一次编辑时补写一次）。 */
  readonly #blocksWritten = new Set<Id>();
  /** 还在进行的后台写块：退出时等它们结束，免得在 Runtime 停下之后还写 Runtime Home 与仓库。 */
  readonly #background = new Set<Promise<void>>();
  #tool: { at: number; value: Promise<{ runner: GitRunner; version: string } | { tool: ExternalToolStatus; problem: NonNullable<ReturnType<typeof toolUseProblem>> }> } | null =
    null;
  #stopping = false;

  constructor(options: ProjectGitServiceOptions) {
    this.#options = options;
    this.#log = options.log;
    this.#gate = new LocalConfigGate(options.storeFile, options.log);
    this.#hooksDir = path.join(options.dir, 'hooks');
    this.#unsubscribe.push(
      options.videos.onChange((change) => {
        if (!change.projectId) return;
        if (!this.#blocksWritten.has(change.projectId)) {
          const project = this.#options.projects().find((item) => item.id === change.projectId);
          if (project) this.projectOpened(project);
        }
        this.#changed(change.projectId);
      }),
      options.videos.onProjectOpened((project) => this.projectOpened(project)),
      options.videos.onClosed((closed) => {
        if (closed.projectId) this.#closed(closed.projectId);
      }),
    );
  }

  /** 建好钩子用的空目录（`core.hooksPath` 指向它）。 */
  async start(): Promise<void> {
    await fs.mkdir(this.#hooksDir, { recursive: true });
  }

  // ---- 方法 ----

  async status(projectId: Id, view: StatusView = {}): Promise<ProjectGitStatus> {
    const project = this.#project(projectId);
    return this.#statusOf(project, await this.#lookup(project.path), view);
  }

  /** 「提交到 git」（§5.3）：先写快照，再只提交 BaoCut 的路径。 */
  async commit(projectId: Id, params: { message?: string | undefined } = {}, view: StatusView = {}): Promise<ProjectGitCommitResult> {
    const project = this.#project(projectId);
    return await this.#serial(projectId, async () => {
      const outcome = await this.#commitOnce(project, { message: params.message, trigger: 'manual', lockRetries: this.#options.lockRetries ?? LOCK_RETRIES });
      const status = this.#statusOf(project, await this.#lookup(project.path), view);
      if (outcome.kind === 'refused') throw outcome.error(status);
      if (outcome.kind === 'locked') {
        throw new RpcError('conflict', RcGit.pausedLocked(), { code: 'GIT_PAUSED', reason: 'locked', ...remedyOf(RcGit.lockedRemedy()), status });
      }
      return outcome.kind === 'committed'
        ? { committed: true, commit: outcome.commit, files: outcome.files, videos: outcome.videos, status }
        : { committed: false, commit: null, files: 0, videos: [], status };
    });
  }

  /** 「初始化 git」（§5.3）：只在用户显式要求时；拒绝名单见 `git-init.ts`。 */
  async init(projectId: Id): Promise<ProjectGitStatus> {
    const project = this.#project(projectId);
    return await this.#serial(projectId, async () => {
      const found = await this.#lookup(project.path);
      if (found.kind === 'unavailable') throw unavailable(found);
      if (found.kind === 'repo') throw initRefused('inside-repo', RcGit.initInsideRepo());
      if (found.kind === 'error') throw new RpcError('internal', RcGit.initFailed({ detail: found.detail }), { code: 'GIT_FAILED' });
      if (found.refusal) throw initRefused(found.refusal.refusal, refusalText(found.refusal));
      const result = await found.runner.run(project.path, ['init', '--quiet']);
      if (result.exitCode !== 0) throw new RpcError('internal', RcGit.initFailed({ detail: gitErrorDetail(result) }), { code: 'GIT_FAILED' });
      this.#log.info('Initialized a git repository for a project', { projectId });
      await ensureInfoBlocks(found.runner, project.path).catch((error) =>
        this.#log.warn('Writing the git info blocks failed', { projectId, error: String(error) }),
      );
      return this.#statusOf(project, await this.#lookup(project.path), {});
    });
  }

  /** 允许这个仓库本地配置里的过滤器与包含（§5.4）：`digest` 必须是用户看过的那一组。 */
  async allowLocalConfig(projectId: Id, digest: string): Promise<ProjectGitStatus> {
    const project = this.#project(projectId);
    const found = await this.#lookup(project.path);
    if (found.kind === 'unavailable') throw unavailable(found);
    if (found.kind !== 'repo') throw notRepo();
    if (found.gate.digest !== digest) {
      throw new RpcError('conflict', RcGit.digestChanged(), {
        code: 'GIT_PAUSED',
        reason: 'local-config',
        status: this.#statusOf(project, found, {}),
      });
    }
    await this.#gate.allow(found.repo, digest);
    this.#log.info('Allowed the local git filters of a project repository', { projectId, entries: found.gate.entries.length });
    return this.#statusOf(project, await this.#lookup(project.path), {});
  }

  /** 打开项目时（以及这次运行里项目的视频第一次改动时）：项目在仓库里就写 `info/*` 的块。失败只记日志。 */
  projectOpened(project: { id: Id; path: string }): void {
    if (this.#stopping) return;
    this.#blocksWritten.add(project.id);
    const run = (async () => {
      const tool = await this.#resolveTool();
      await ensureInfoBlocks('runner' in tool ? tool.runner : null, hostPath(project.path));
    })()
      .catch((error) => this.#log.warn('Writing the git info blocks failed', { projectId: project.id, error: String(error) }))
      .finally(() => this.#background.delete(run));
    this.#background.add(run);
  }

  /** 退出 BaoCut（§5.3）：打开了自动提交的项目把还没提交的改动提交一次，整体有时限；之后不再起新的提交。 */
  async shutdown(): Promise<void> {
    this.#stopping = true;
    for (const stop of this.#unsubscribe.splice(0)) stop();
    const pending: Array<Promise<unknown>> = [];
    for (const [projectId, record] of this.#records) {
      if (record.timer) clearTimeout(record.timer);
      record.timer = null;
      if (record.dirty && this.#options.settings().autoCommit) pending.push(this.#auto(projectId, { lockRetries: 1 }));
    }
    pending.push(...this.#queues.values(), ...this.#background);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          this.#log.warn('Committing to git on exit took too long; leaving the rest for the next run');
          resolve();
        }, EXIT_BUDGET_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  // ---- 自动提交 ----

  #changed(projectId: Id): void {
    if (this.#stopping) return;
    const record = this.#record(projectId);
    record.dirty = true;
    if (!this.#options.settings().autoCommit) return;
    if (record.timer) clearTimeout(record.timer);
    record.timer = setTimeout(() => {
      record.timer = null;
      void this.#auto(projectId, {});
    }, this.#options.quietMs ?? QUIET_MS);
    record.timer.unref?.();
  }

  #closed(projectId: Id): void {
    if (this.#stopping) return;
    const record = this.#records.get(projectId);
    if (!record?.dirty || this.#options.videos.openProjectVideoCount(projectId) > 0) return;
    if (!this.#options.settings().autoCommit) return;
    if (record.timer) clearTimeout(record.timer);
    record.timer = null;
    void this.#auto(projectId, {});
  }

  async #auto(projectId: Id, options: { lockRetries?: number }): Promise<void> {
    const project = this.#find(projectId);
    if (!project || !this.#options.settings().autoCommit) return;
    await this.#serial(projectId, async () => {
      const outcome = await this.#commitOnce(project, {
        trigger: 'auto',
        lockRetries: options.lockRetries ?? this.#options.lockRetries ?? LOCK_RETRIES,
      });
      if (outcome.kind === 'locked' && !this.#stopping) {
        // 推迟到下一次：仓库正被占用时过 5 分钟再试。
        this.#log.info('Auto-commit deferred: the repository is locked', { projectId });
        this.#changed(projectId);
      } else if (outcome.kind === 'refused') {
        this.#log.info('Auto-commit skipped', { projectId, reason: outcome.reason });
      }
    }).catch((error) => this.#log.warn('Auto-commit failed', { projectId, error: String(error) }));
  }

  // ---- 提交 ----

  async #commitOnce(
    project: Project,
    options: { message?: string | undefined; trigger: 'manual' | 'auto'; lockRetries: number },
  ): Promise<
    | Extract<CommitOutcome, { kind: 'committed' | 'nothing' | 'locked' }>
    | { kind: 'refused'; reason: string; error: (status: ProjectGitStatus) => RpcError }
  > {
    const record = this.#record(project.id);
    // 先写快照（§2.4）：打开中的视频立即写一次。
    await this.#options.videos.flushProjectSnapshots(project.id);
    const found = await this.#lookup(project.path);
    if (found.kind === 'unavailable') return { kind: 'refused', reason: 'unavailable', error: () => unavailable(found) };
    if (found.kind === 'not-repo') return { kind: 'refused', reason: 'not-repo', error: () => notRepo() };
    if (found.kind === 'error') {
      const message = RcGit.gitFailed({ detail: found.detail });
      this.#failed(record, message);
      return { kind: 'refused', reason: 'error', error: () => new RpcError('internal', message, { code: 'GIT_FAILED' }) };
    }
    const pause = pauseOf(found);
    if (pause && pause.reason !== 'locked') {
      return {
        kind: 'refused',
        reason: pause.reason,
        error: (status) => new RpcError('conflict', pause.message, { code: 'GIT_PAUSED', reason: pause.reason, ...remedyOf(pause.remedy), status }),
      };
    }
    let outcome: CommitOutcome;
    try {
      await ensureInfoBlocks(found.runner, project.path).catch((error) =>
        this.#log.warn('Writing the git info blocks failed', { projectId: project.id, error: String(error) }),
      );
      outcome = await commitProject({
        runner: found.runner,
        repo: found.repo,
        projectDir: project.path,
        maxFileBytes: this.#options.settings().maxFileMiB * 1024 * 1024,
        message: options.message,
        fallbackTitle: (names) => RcGit.commitTitle({ names: names.join(', ') }).text,
        messageDir: path.join(this.#options.dir, 'messages'),
        lockRetries: options.lockRetries,
        lockDelayMs: this.#options.lockDelayMs ?? LOCK_DELAY_MS,
      });
    } catch (error) {
      const detail = error instanceof GitRunError || error instanceof Error ? error.message : String(error);
      const message = RcGit.commitFailed({ detail });
      this.#failed(record, message);
      this.#log.warn('Committing to git failed', { projectId: project.id, trigger: options.trigger, error: detail });
      return { kind: 'refused', reason: 'error', error: () => new RpcError('internal', message, { code: 'GIT_FAILED' }) };
    }
    if (outcome.kind === 'committed') {
      record.lastCommit = { commit: outcome.commit, at: nowIso(), trigger: options.trigger, videos: outcome.videos };
      record.lastError = null;
      record.dirty = false;
      this.#log.info('Committed BaoCut files to git', { projectId: project.id, trigger: options.trigger, commit: outcome.commit, files: outcome.files });
    } else if (outcome.kind === 'nothing') {
      record.lastError = null;
      record.dirty = false;
    }
    return outcome;
  }

  #failed(record: ProjectRecord, message: Localized): void {
    record.lastError = { message: message.text, messageRef: refOf(message), at: nowIso() };
  }

  async #serial<T>(projectId: Id, run: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(run);
    const tail = next.catch(() => {});
    this.#queues.set(projectId, tail);
    void tail.then(() => {
      if (this.#queues.get(projectId) === tail) this.#queues.delete(projectId);
    });
    return await next;
  }

  // ---- 查找 ----

  async #resolveTool(): Promise<
    { runner: GitRunner; version: string } | { tool: ExternalToolStatus; problem: NonNullable<ReturnType<typeof toolUseProblem>> }
  > {
    const now = Date.now();
    if (!this.#tool || now - this.#tool.at > TOOL_CACHE_MS) {
      const value = (async () => {
        const tool = await this.#options.tools.status(GIT);
        const problem = toolUseProblem(tool);
        if (problem) return { tool, problem };
        await fs.mkdir(this.#hooksDir, { recursive: true });
        const runner = new GitRunner({
          git: tool.path!,
          env: await this.#options.env(),
          hooksDir: this.#hooksDir,
          ...(this.#options.platform ? { platform: this.#options.platform } : {}),
        });
        return { runner, version: tool.version! };
      })();
      this.#tool = { at: now, value };
      // 探测失败不留在缓存里。
      value.catch(() => {
        if (this.#tool?.value === value) this.#tool = null;
      });
    }
    return await this.#tool.value;
  }

  async #lookup(dir: string): Promise<Lookup> {
    const tool = await this.#resolveTool();
    if ('problem' in tool) return { kind: 'unavailable', tool: tool.tool, message: tool.problem.message, remedy: tool.problem.remedy };
    const { runner, version } = tool;
    try {
      const found = await findRepo(runner, dir);
      if (found.kind === 'not-repo') {
        return { kind: 'not-repo', runner, version, refusal: await initRefusal(dir, { home: this.#options.home, platform: this.#options.platform }) };
      }
      if (found.kind === 'error') return { kind: 'error', runner, version, detail: found.detail };
      const repo = found.repo;
      const gate = await this.#gate.check(runner, repo);
      const { state, branch } = await repoState(runner, dir);
      const [lockFile] = (await gitPaths(runner, dir, ['index.lock'])) as [string];
      return { kind: 'repo', runner, version, repo, gate, state, branch, locked: await exists(lockFile) };
    } catch (error) {
      return { kind: 'error', runner, version, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  // ---- 状态 ----

  #statusOf(project: Project, found: Lookup, view: StatusView): ProjectGitStatus {
    const record = this.#records.get(project.id);
    const base = {
      projectId: project.id,
      gitVersion: found.kind === 'unavailable' ? null : found.version,
      branch: found.kind === 'repo' ? found.branch : null,
      autoCommit: this.#options.settings().autoCommit,
      lastCommit: record?.lastCommit ?? null,
      lastError: record?.lastError ?? null,
    };
    const said = (reason: Localized, remedy?: Localized | string) => ({
      reason: reason.text,
      reasonRef: refOf(reason),
      ...(remedy === undefined ? {} : typeof remedy === 'string' ? { remedy } : remedyOf(remedy)),
    });
    switch (found.kind) {
      case 'unavailable':
        return { ...base, state: 'unavailable', ...said(found.message, view.web ? undefined : found.remedy) };
      case 'error':
        return { ...base, state: 'error', ...said(RcGit.gitFailed({ detail: found.detail })) };
      case 'not-repo':
        return {
          ...base,
          state: 'not-repo',
          init: found.refusal ? { allowed: false, refusal: found.refusal.refusal } : { allowed: true },
          ...said(RcGit.notRepo(), found.refusal ? RcGit.initElsewhere() : RcGit.initRemedy()),
        };
      case 'repo': {
        const pause = pauseOf(found);
        const repoRoot = view.web ? {} : { repoRoot: found.repo.root };
        if (!pause) return { ...base, ...repoRoot, state: 'ready' };
        return {
          ...base,
          ...repoRoot,
          state: 'paused',
          pause: {
            reason: pause.reason,
            ...(pause.reason === 'repo-state' ? { repoState: found.state! } : {}),
            ...(pause.reason === 'local-config'
              ? {
                  localConfig: {
                    ...(view.web ? {} : { entries: found.gate.entries }),
                    digest: found.gate.digest!,
                    changed: found.gate.changed,
                  },
                }
              : {}),
          },
          ...said(pause.message, pause.remedy),
        };
      }
    }
  }

  #project(projectId: Id): Project {
    const project = this.#find(projectId);
    if (!project) throw new RpcError('not-found', RcRuntime.projectNotFound());
    return project;
  }

  /** 登记的项目，路径换成 Node 与 git 认的形式（Windows 的 `\\?\` 扩展路径去掉前缀）。 */
  #find(projectId: Id): Project | undefined {
    const project = this.#options.projects().find((item) => item.id === projectId);
    return project && { ...project, path: hostPath(project.path) };
  }

  #record(projectId: Id): ProjectRecord {
    let record = this.#records.get(projectId);
    if (!record) this.#records.set(projectId, (record = { lastCommit: null, lastError: null, dirty: false, timer: null }));
    return record;
  }
}

/** 暂停的原因与说明（本地配置 → 特殊状态 → 锁）；能提交时 null。 */
function pauseOf(
  found: Extract<Lookup, { kind: 'repo' }>,
): { reason: 'local-config' | 'repo-state' | 'locked'; message: Localized; remedy: Localized } | null {
  if (!found.gate.allowed) {
    return {
      reason: 'local-config',
      message: found.gate.changed ? RcGit.pausedLocalConfigChanged() : RcGit.pausedLocalConfig(),
      remedy: RcGit.localConfigRemedy(),
    };
  }
  if (found.state) {
    const message = {
      merge: RcGit.pausedMerge,
      rebase: RcGit.pausedRebase,
      'cherry-pick': RcGit.pausedCherryPick,
      revert: RcGit.pausedRevert,
      bisect: RcGit.pausedBisect,
      detached: RcGit.pausedDetached,
    }[found.state]();
    return { reason: 'repo-state', message, remedy: found.state === 'detached' ? RcGit.detachedRemedy() : RcGit.repoStateRemedy() };
  }
  if (found.locked) return { reason: 'locked', message: RcGit.pausedLocked(), remedy: RcGit.lockedRemedy() };
  return null;
}

function unavailable(found: Extract<Lookup, { kind: 'unavailable' }>): RpcError {
  return new RpcError('conflict', found.message, {
    code: 'GIT_UNAVAILABLE',
    reason: 'missing',
    tool: GIT,
    state: found.tool.state,
    ...(typeof found.remedy === 'string' ? { remedy: found.remedy } : remedyOf(found.remedy)),
  });
}

function notRepo(): RpcError {
  return new RpcError('conflict', RcGit.notRepo(), { code: 'GIT_UNAVAILABLE', reason: 'not-repo', ...remedyOf(RcGit.initRemedy()) });
}

function initRefused(reason: string, message: Localized): RpcError {
  return new RpcError('invalid-request', message, { code: 'GIT_INIT_REFUSED', reason, ...remedyOf(RcGit.initElsewhere()) });
}

function refusalText(refusal: NonNullable<Awaited<ReturnType<typeof initRefusal>>>): Localized {
  if (refusal.refusal === 'home') return RcGit.initHome();
  if (refusal.refusal === 'user-folder') return RcGit.initUserFolder({ path: refusal.folder ?? '' });
  return RcGit.initVolumeRoot();
}
