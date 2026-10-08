import { collectArtifactIds, isTerminal, type ArtifactStore, type ArtifactSweepResult } from '@baocut/jobs';
import { trimCache, type CacheTrimResult } from '@baocut/runtime-storage';
import type { Id, JobRecord } from '@baocut/protocol';

/** 两项清理之间的定时：缓存每小时核一次大小；产物库上一轮因为有任务在途跳过时，同一个定时补跑。 */
export const STORAGE_GC_INTERVAL_MS = 60 * 60 * 1000;
/** 账本淘汰任务之后，等一会儿再清产物库：连续结束的任务合并成一轮。 */
const PRUNE_DEBOUNCE_MS = 30 * 1000;

export interface StorageGcOptions {
  jobs: {
    readonly artifacts: ArtifactStore;
    referencedArtifactIds(): Set<string>;
    onPruned(listener: (evicted: ReadonlySet<Id>) => void): () => void;
    list(): JobRecord[];
  };
  /** Space 的产物记录（Job Ledger 修剪之后仍然登记着的产物）。 */
  spaceArtifacts: { list(): readonly unknown[] };
  /** 产物记录与 Job Ledger 都读进来、Space 已经从账本补齐记录之后兑现。 */
  ready: Promise<unknown>;
  /** 产物记录整个读不了、从空的开始时给出原因：引用不全，不清产物库。 */
  artifactSweepBlocked?: string | null;
  cacheDir: string;
  /** 缓存的上限（字节），每次清理时取当时的设置。 */
  cacheMaxBytes: () => number;
  log: { info(message: string, fields?: Record<string, unknown>): void; warn(message: string, fields?: Record<string, unknown>): void };
  intervalMs?: number;
  pruneDebounceMs?: number;
}

/**
 * Runtime Home 的两项后台清理（架构设计 §5.1、§7.3）：
 *
 * - **产物库**：账本里全部任务（任何状态，含冻结的规格与发布意图）与 Space 产物记录都没有引用、修改时间超过 1 小时的
 *   `artifacts/<sha256>.<ext>` 删掉，残留的 `.tmp` 同样。启动后（`ready` 兑现时）跑一轮，之后每次账本淘汰任务后再跑。
 *   有排队或运行中的任务时跳过：流程在步骤完成之前只在暂存目录与内存里记着它刚写的产物，这些不在引用集合里；
 *   跳过之后由下一次淘汰或每小时的定时补跑。
 * - **缓存**：`cache/` 超过上限时按修改时间删最旧的，降到上限的 90%（`trimCache`）。启动后跑一轮，之后每小时一次。
 *
 * 都在后台跑，失败只记 warn；结果记 info。
 */
export class StorageGc {
  readonly #options: StorageGcOptions;
  #closed = false;
  #timer: NodeJS.Timeout | null = null;
  #debounce: NodeJS.Timeout | null = null;
  #unsubscribe: (() => void) | null = null;
  #artifactRun: Promise<ArtifactSweepResult | null> | null = null;
  #artifactPending = false;
  #cacheRun: Promise<CacheTrimResult | null> | null = null;
  #blockedLogged = false;
  #cacheChecked = false;

  constructor(options: StorageGcOptions) {
    this.#options = options;
  }

  start(): void {
    this.#unsubscribe = this.#options.jobs.onPruned(() => this.#schedulePruneSweep());
    this.#timer = setInterval(() => {
      void this.trimCache();
      if (this.#artifactPending) void this.sweepArtifacts();
    }, this.#options.intervalMs ?? STORAGE_GC_INTERVAL_MS);
    this.#timer.unref?.();
    void this.#options.ready.then(
      () => {
        if (this.#closed) return;
        void this.sweepArtifacts();
        void this.trimCache();
      },
      (error: unknown) => this.#options.log.warn('Storage cleanup did not start', { error: String(error) }),
    );
  }

  /** 停掉定时；进行中的一轮跑完为止。 */
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#unsubscribe?.();
    await Promise.allSettled([this.#artifactRun, this.#cacheRun].filter(Boolean));
  }

  /** 清一轮产物库。正在跑时返回那一轮；被跳过（有任务在途、引用不全、已经关了）时兑现为 null。不抛错。 */
  sweepArtifacts(): Promise<ArtifactSweepResult | null> {
    if (this.#artifactRun) {
      this.#artifactPending = true;
      return this.#artifactRun;
    }
    const run = this.#sweepArtifacts().finally(() => {
      if (this.#artifactRun === run) this.#artifactRun = null;
    });
    this.#artifactRun = run;
    return run;
  }

  /** 核一轮缓存的大小。不抛错。 */
  trimCache(): Promise<CacheTrimResult | null> {
    if (this.#cacheRun) return this.#cacheRun;
    const run = this.#trimCache().finally(() => {
      if (this.#cacheRun === run) this.#cacheRun = null;
    });
    this.#cacheRun = run;
    return run;
  }

  #schedulePruneSweep(): void {
    if (this.#closed || this.#debounce) return;
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      void this.sweepArtifacts();
    }, this.#options.pruneDebounceMs ?? PRUNE_DEBOUNCE_MS);
    this.#debounce.unref?.();
  }

  async #sweepArtifacts(): Promise<ArtifactSweepResult | null> {
    const { log } = this.#options;
    if (this.#closed) return null;
    if (this.#options.artifactSweepBlocked) {
      if (!this.#blockedLogged) {
        this.#blockedLogged = true;
        log.warn('Skipped artifact cleanup: the output references are incomplete', { reason: this.#options.artifactSweepBlocked });
      }
      return null;
    }
    try {
      const active = this.#options.jobs.list().filter((job) => !isTerminal(job.state)).length;
      if (active > 0) {
        this.#artifactPending = true;
        log.info('Deferred artifact cleanup while tasks are running', { active });
        return null;
      }
      this.#artifactPending = false;
      const referenced = this.#options.jobs.referencedArtifactIds();
      collectArtifactIds(this.#options.spaceArtifacts.list(), referenced);
      const result = await this.#options.jobs.artifacts.sweep(referenced);
      if (result) log.info('Artifact cleanup finished', { ...result, referenced: referenced.size });
      return result;
    } catch (error) {
      log.warn('Artifact cleanup failed', { error: String(error) });
      return null;
    }
  }

  async #trimCache(): Promise<CacheTrimResult | null> {
    const { log } = this.#options;
    if (this.#closed) return null;
    try {
      const maxBytes = this.#options.cacheMaxBytes();
      const result = await trimCache(this.#options.cacheDir, { maxBytes });
      // 每小时一次：没删东西时只在第一轮记一笔。
      if (result.removed > 0 || result.failed > 0 || !this.#cacheChecked) log.info('Cache size check finished', { ...result, maxBytes });
      this.#cacheChecked = true;
      if (result.protectedBytes > maxBytes) log.warn('Cache files that are never removed exceed the cache limit', { protectedBytes: result.protectedBytes, maxBytes });
      return result;
    } catch (error) {
      log.warn('Cache cleanup failed', { error: String(error) });
      return null;
    }
  }
}
