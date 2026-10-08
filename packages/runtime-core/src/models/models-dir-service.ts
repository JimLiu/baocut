import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '@baocut/harness';
import {
  canonicalJson,
  isTerminal,
  sha256Hex,
  type JobManager,
  type LocalTranscribeProvider,
  type TaskRun,
} from '@baocut/jobs';
import {
  clearMoveJournal,
  diskFreeBytes,
  dirAccess,
  moveModels,
  nestedDirs,
  planMove,
  recoverMove,
  removeSources,
  sameVolume,
  scanModelsDir,
  undoMove,
  type ModelCatalog,
  type MoveRepo,
} from '@baocut/models';
import {
  RpcError,
  refOf,
  type Id,
  type JobRecord,
  type JobSubmitter,
  type ModelsDirChangeResult,
  type ModelsDirInfo,
  type ModelsDirInspection,
  type ModelsDirMode,
  type ModelsDirSource,
} from '@baocut/protocol';
import { RcModels } from '@baocut/protocol/messages/runtime-core';
import { taskFailure } from '../localized.ts';

/**
 * 模型目录（架构设计 §6.3）：`models.getDir` / `inspectDir` / `setDir`。
 *
 * 生效的目录：Runtime 启动时环境变量 `BAOCUT_MODELS_DIR` 给了目录就用它（只读，`setDir` 以 `MODELS_DIR_ENV_LOCKED`
 * 拒绝）；否则用设置 `models.dir`；都没有时 `<runtime-home>/models`。
 *
 * 更改的顺序：查在用（排队或进行中的本地模型任务、移动）→ 卸下所有空闲的 Worker（有忙的就拒绝）→ 再查一次 →
 * `switch` 时写设置、换模型目录的根；`move` 时提交一个 `modelsMove` 任务，期间模型包都报告为 `relocating`、不能提交任务，
 * 搬完、校验完再写设置、换根、删原目录里的文件。中途失败或取消时回滚，设置与模型目录不变。
 */

const MOVE_QUEUE = { key: 'models:dir', concurrency: 1 };
/** 移动进度最多每这么久报一次。 */
const PROGRESS_INTERVAL_MS = 250;
/** 不带模型包、也算在用模型目录的任务种类。 */
const DIR_KINDS = new Set<JobRecord['kind']>(['modelInstall', 'modelTest', 'modelsMove']);

export interface ModelsDirServiceOptions {
  /** 缺省目录：`<runtime-home>/models`。 */
  defaultDir: string;
  /** Runtime 启动时环境变量给的目录；没有时 null（这时设置生效）。 */
  envDir: string | null;
  /** 设置 `models.dir` 的读写（写盘成功才算改了）。 */
  setting: { get(): string | null; set(value: string | null): Promise<void> };
  catalog: ModelCatalog;
  provider: LocalTranscribeProvider;
  jobs: JobManager;
  log: Logger;
  /** 所在磁盘的可用空间（测试注入）；默认按 statfs。 */
  freeBytes?: (dir: string) => Promise<number | null>;
  /** 换了目录之后重算能力视图。 */
  refresh: () => void;
  /** 测试用的钩子。 */
  testing?: ModelsDirTestHooks;
}

export interface ModelsDirTestHooks {
  /** 每个仓库放到位之前调一次（卡住移动、注入中途的失败）。 */
  beforePlace?: (repo: string) => Promise<void> | void;
  /** 代替按 `stat.dev` 判断两个目录在不在同一块盘（假装跨盘）。 */
  sameVolume?: (a: string, b: string) => Promise<boolean>;
}

export class ModelsDirService {
  readonly #options: ModelsDirServiceOptions;
  readonly #log: Logger;
  readonly #freeBytes: (dir: string) => Promise<number | null>;
  readonly #sameVolume: (a: string, b: string) => Promise<boolean>;
  /** 移动任务 → 目标目录（给 `getDir` 的 `moveTo`）。 */
  readonly #moveTargets = new Map<Id, string>();

  constructor(options: ModelsDirServiceOptions) {
    this.#options = options;
    this.#log = options.log.child('models-dir');
    this.#freeBytes = options.freeBytes ?? diskFreeBytes;
    this.#sameVolume = options.testing?.sameVolume ?? sameVolume;
    // 排队时就被取消、Runtime 停止时中断的移动没有跑到 `finally`：回到可用。
    options.jobs.onChange((job) => {
      if (job.kind === 'modelsMove' && isTerminal(job.state)) this.#moveTargets.delete(job.jobId);
      if (job.kind === 'modelsMove' && isTerminal(job.state) && !this.#activeMove()) {
        options.catalog.setRelocating(false);
        options.refresh();
      }
    });
  }

  /** 生效的目录与来源（只看配置，不碰磁盘）。 */
  resolve(): { path: string; source: ModelsDirSource } {
    if (this.#options.envDir) return { path: this.#options.envDir, source: 'env' };
    const setting = this.#options.setting.get();
    if (setting && path.resolve(setting) !== this.#options.defaultDir) return { path: path.resolve(setting), source: 'setting' };
    return { path: this.#options.defaultDir, source: 'default' };
  }

  /** Runtime 启动时：上次的移动没有做完时回滚（原目录里留着日志）。 */
  async recover(): Promise<void> {
    const root = this.#options.catalog.root;
    const recovered = await recoverMove(root).catch((error: unknown) => {
      this.#log.error('Rolling back the unfinished models folder move failed', { error: String(error) });
      return null;
    });
    if (recovered) {
      this.#log.warn('The last models folder move was unfinished and was rolled back', { restored: recovered.restored });
      for (const def of this.#options.catalog.definitions()) this.#options.catalog.changed(def.bundleId);
    }
  }

  async getDir(): Promise<ModelsDirInfo> {
    const { catalog } = this.#options;
    const { source } = this.resolve();
    const root = catalog.root;
    const move = this.#activeMove();
    const access = await dirAccess(root);
    const scan = await scanModelsDir(root, catalog.definitions());
    const bundles = await catalog.list();
    const modelCount = bundles.filter((b) => {
      const required = (b.components ?? []).filter((c) => !c.optional);
      return required.length > 0 && required.every((c) => c.state === 'installed');
    }).length;
    return {
      path: root,
      source,
      defaultPath: this.#options.defaultDir,
      exists: access.exists,
      writable: access.writable,
      usedBytes: scan.bytes,
      freeBytes: access.exists ? await this.#freeBytes(root) : null,
      modelCount,
      moveJobId: move?.jobId ?? null,
      moveTo: move ? (this.#moveTargets.get(move.jobId) ?? null) : null,
    };
  }

  async inspect(target: string | null): Promise<ModelsDirInspection> {
    const { catalog } = this.#options;
    const dir = target === null ? this.#options.defaultDir : path.resolve(target);
    const current = catalog.root;
    const access = await dirAccess(dir);
    const relation = nestedDirs(current, dir);
    const found = access.exists ? await scanModelsDir(dir, catalog.definitions()) : { repos: [], bundleIds: [], bytes: 0 };
    const mine = await scanModelsDir(current, catalog.definitions());
    const plan = access.exists && relation === null ? await planMove(current, dir, catalog.definitions()) : null;
    const same = access.exists && relation === null && (await this.#sameVolume(current, dir));
    const freeBytes = access.exists ? await this.#freeBytes(dir) : await this.#freeBytes(path.dirname(dir));
    const requiredBytes = plan?.bytes ?? 0;
    const problem: ModelsDirInspection['problem'] =
      relation === 'same'
        ? 'same'
        : !access.exists
          ? 'missing'
          : !access.writable
            ? 'not-writable'
            : relation === 'nested'
              ? 'nested'
              : null;
    return {
      path: dir,
      exists: access.exists,
      writable: access.writable,
      freeBytes,
      problem,
      found: { repos: found.repos, bundleIds: found.bundleIds, bytes: found.bytes },
      current: { repos: mine.repos.filter((r) => r.known), bundleIds: mine.bundleIds, bytes: mine.bytes },
      move: { requiredBytes, sameVolume: same, fits: same || requiredBytes === 0 || freeBytes === null || requiredBytes <= freeBytes },
    };
  }

  /** 更改模型目录。 */
  async setDir(
    params: { path: string | null; mode: ModelsDirMode; commandId?: Id },
    submitter: JobSubmitter,
  ): Promise<ModelsDirChangeResult> {
    if (params.commandId) {
      const existing = this.#options.jobs.jobForCommand(params.commandId);
      if (existing) return { dir: await this.getDir(), jobId: existing };
    }
    if (this.#options.envDir) {
      throw new RpcError('conflict', RcModels.envLocked(), {
        code: 'MODELS_DIR_ENV_LOCKED',
        path: this.#options.envDir,
      });
    }
    // 正在移动时一律不改（连「改回当前位置」也不行：移动完成后当前位置就变了）。
    const move = this.#activeMove();
    if (move) {
      throw new RpcError('conflict', RcModels.movingDirWaitOrCancel(), { code: 'MODEL_IN_USE', jobIds: [move.jobId] });
    }
    const target = params.path === null ? this.#options.defaultDir : path.resolve(params.path);
    if (target === this.#options.catalog.root) return { dir: await this.getDir(), jobId: null };
    if (target === this.#options.defaultDir) await fs.mkdir(target, { recursive: true }).catch(() => {});
    const inspection = await this.inspect(target);
    if (inspection.problem === 'missing') {
      throw new RpcError('conflict', RcModels.folderMissing(), { code: 'MODELS_DIR_MISSING', path: target });
    }
    if (inspection.problem === 'not-writable') {
      throw new RpcError('conflict', RcModels.folderNotWritable(), { code: 'MODELS_DIR_NOT_WRITABLE', path: target });
    }
    if (inspection.problem === 'nested') {
      throw new RpcError('conflict', RcModels.dirNested(), {
        code: 'MODELS_DIR_NESTED',
        path: target,
      });
    }
    const moving = params.mode === 'move' && inspection.move.requiredBytes + inspection.current.bytes > 0;
    if (moving && !inspection.move.fits) {
      throw new RpcError('conflict', RcModels.noSpaceForMove(), {
        code: 'MODELS_DIR_NO_SPACE',
        requiredBytes: inspection.move.requiredBytes,
        availableBytes: inspection.freeBytes,
        remedy: RcModels.noSpaceRemedy().text,
        remedyRef: refOf(RcModels.noSpaceRemedy()),
      });
    }
    await this.#quiesce();
    if (!moving) {
      await this.#switchTo(target);
      this.#log.info('Models folder switched', { to: target, mode: params.mode });
      return { dir: await this.getDir(), jobId: null };
    }
    return { dir: await this.getDir(), jobId: await this.#submitMove(target, submitter, params.commandId) };
  }

  /** 正在用本地模型的任务（排队或进行中）：转写、合成、安装、自测、移动。 */
  inUse(): Id[] {
    return this.#options.jobs
      .list()
      .filter((j) => !isTerminal(j.state) && (j.bundleId || DIR_KINDS.has(j.kind)))
      .map((j) => j.jobId);
  }

  /** 进行中的移动；没有时 null。 */
  activeMove(): JobRecord | null {
    return this.#activeMove();
  }

  /** 没有任务在用、所有 Worker 都卸下了；否则 `MODEL_IN_USE`。 */
  async #quiesce(): Promise<void> {
    const refuse = (jobIds: Id[]): never => {
      throw new RpcError('conflict', RcModels.dirInUse(), { code: 'MODEL_IN_USE', jobIds });
    };
    if (this.inUse().length > 0) refuse(this.inUse());
    for (const def of this.#options.catalog.definitions()) {
      if (!(await this.#options.provider.unload(def.bundleId))) refuse(this.inUse());
    }
    if (this.inUse().length > 0) refuse(this.inUse());
  }

  async #switchTo(target: string): Promise<void> {
    await this.#options.setting.set(target === this.#options.defaultDir ? null : target);
    this.#options.catalog.setRoot(target);
    this.#options.refresh();
  }

  async #submitMove(target: string, submitter: JobSubmitter, commandId: Id | undefined): Promise<Id> {
    const from = this.#options.catalog.root;
    const plan = await planMove(from, target, this.#options.catalog.definitions());
    const same = await this.#sameVolume(from, target);
    const spec = { task: 'modelsMove' as const, from, to: target, repos: plan.move.map((r) => r.repo), bytes: plan.bytes };
    const hash = `sha256:${sha256Hex(canonicalJson({ ...spec, at: Date.now() }))}`;
    const { jobId } = this.#options.jobs.submitTask(
      {
        kind: 'modelsMove',
        spec,
        videoId: null,
        contentHash: hash,
        inputHash: hash,
        providerId: 'local',
        modelId: 'models-dir',
        ...(commandId ? { commandId } : {}),
        queue: MOVE_QUEUE,
        run: (run) => this.#runMove(run, from, target, plan.move, plan.present, same),
      },
      submitter,
    );
    this.#moveTargets.set(jobId, target);
    // 提交之后马上不可用：排队的这一会儿也不能有新的本地任务进来。
    this.#options.catalog.setRelocating(true);
    this.#options.refresh();
    this.#log.info('Models folder move submitted', { jobId, from, to: target, bytes: plan.bytes, sameVolume: same });
    return jobId;
  }

  async #runMove(
    run: TaskRun,
    from: string,
    to: string,
    repos: MoveRepo[],
    present: MoveRepo[],
    same: boolean,
  ): Promise<NonNullable<JobRecord['result']>> {
    const { catalog } = this.#options;
    catalog.setRelocating(true);
    let last = 0;
    let lastPhase = '';
    try {
      await moveModels({
        from,
        to,
        repos,
        sameVolume: same,
        signal: run.signal,
        ...(this.#options.testing?.beforePlace ? { beforePlace: this.#options.testing.beforePlace } : {}),
        onProgress: (p) => {
          const now = Date.now();
          if (p.phase === lastPhase && now - last < PROGRESS_INTERVAL_MS && p.done < p.total) return;
          last = now;
          lastPhase = p.phase;
          run.phase(p.phase, { done: p.done, total: p.total, unit: 'bytes' });
        },
      });
      run.phase('publishing', null);
      try {
        await this.#options.setting.set(to === this.#options.defaultDir ? null : to);
      } catch (error) {
        // 换不过去：把搬过去的撤回来，模型目录照旧。
        await undoMove(
          from,
          to,
          repos.map((r) => r.repo),
          same,
        );
        await clearMoveJournal(from);
        throw error;
      }
      catalog.setRoot(to);
      await clearMoveJournal(from);
      const leftovers = await removeSources(
        from,
        [...repos, ...present].map((r) => r.repo),
      );
      if (leftovers.length > 0) {
        const kept = RcModels.sourceKept({ count: leftovers.length });
        run.warn({ code: 'MODELS_DIR_SOURCE_KEPT', detail: kept.text, detailRef: refOf(kept) });
      }
      const { artifactId } = await this.#options.jobs.artifacts.put(
        Buffer.from(
          canonicalJson({
            schema: 'baocut.models-move/1',
            from,
            to,
            sameVolume: same,
            moved: repos.map((r) => r.repo),
            alreadyThere: present.map((r) => r.repo),
            bytes: repos.reduce((n, r) => n + r.bytes, 0),
            leftovers,
          }),
        ),
      );
      this.#log.info('Models folder move finished', { jobId: run.jobId, to, moved: repos.length });
      return { documentId: null, artifactId };
    } catch (error) {
      if (run.signal.aborted) throw error;
      this.#log.error('Models folder move failed and was rolled back', { jobId: run.jobId, error: String(error) });
      const nospace = (error as NodeJS.ErrnoException).code === 'ENOSPC';
      const remedy = RcModels.moveFailedRemedy();
      throw taskFailure(
        nospace ? 'MODELS_DIR_NO_SPACE' : 'MODELS_DIR_MOVE_FAILED',
        nospace ? RcModels.moveNoSpace() : RcModels.moveFailed(),
        {
          reason: String(error),
          remedy: remedy.text,
          remedyRef: refOf(remedy),
        },
      );
    } finally {
      catalog.setRelocating(false);
      this.#options.refresh();
    }
  }

  #activeMove(): JobRecord | null {
    return this.#options.jobs.list().find((j) => j.kind === 'modelsMove' && !isTerminal(j.state)) ?? null;
  }
}
