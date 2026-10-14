import crypto from 'node:crypto';
import type { Id } from '@baocut/protocol';
import { EmbeddingError, digestText, formatEmbeddingInput, type EmbeddingProfile } from '@baocut/models';
import type { Logger } from '@baocut/harness';
import type { SpaceVideo } from '../../space-catalog.ts';
import type { ContentIndex, ContentReader } from '../content-index.ts';
import { extractContent } from '../content-extract.ts';
import { chunkVideo, type ChunkDraft } from './chunks.ts';
import type { EmbeddingScheduler } from './scheduler.ts';
import { TEXT_BATCH_MAX } from './scheduler.ts';
import { recordRate, TEXT_RATE_MIN_FRESH } from './estimate.ts';
import type { PowerState } from './power.ts';
import type { SemanticStore } from './store.ts';
import type { VectorScanner } from './vector-index.ts';
import { VisualLane, type KeyframeSource } from './visual-lane.ts';

/**
 * 语义索引的增量构建（EmbeddingGemma 2 检索集成方案 v0.1 §9）。跟着内容索引走：内容索引读完一个视频的新版本（`listen`）就排进来；
 * 只处理已经有当前内容索引的视频，一次一个视频、每批最多 16 条（§16.1），批次之间让出事件循环，交互调用（查询向量）由调度器插队。
 *
 * 每个视频的步骤（§9.2）：读内容（与内容索引同一个只读查询）→ 冻结版本 → 分片 → 按 `embeddingKey` 查已有向量 → 只编码缺的、
 * 每批验证后立刻提交（崩溃或重启后已提交的不重算）→ 一个事务里核对版本与世代指针后发布。迟到的旧结果核对不过，不覆盖新版本。
 *
 * - 没有可用的 Provider（没装模型）时什么都不做：不读视频、不排队。
 * - 暂停记在库里（重启后仍暂停）；暂停时手上那一批编码完就停，不发布半成品。
 * - 供电与散热（规范 §16.1）：有活要干时每隔 `powerPollMs` 查一次；用电池（设置 `pauseOnBattery`）或过热降频时像暂停一样
 *   停下，只记在内存里（不改用户的暂停），恢复供电、温度回落后接着建。
 * - 每个视频编码花的时间记成这一路的速度（`estimate.ts`），`space.indexStatus` 用它估还要多久。
 * - 文字通道跟着设置走：关掉文字通道等同暂停文字构建（已建的索引仍可检索）。
 * - 画面通道（`visual-lane.ts`）在文字那一路空下来时才建，与文字共用暂停与清理；没给取帧来源时不建画面。
 * - Space 目录里已经没有的视频（扫描完成、内容索引不再有它）撤下索引，立即不可检索。
 *
 * 读内容多花一次引擎只读查询：内容索引的库不存句子身份（§19：这一阶段不改旧索引的表结构），这里按变化重读一次。
 */

export interface SemanticSettings {
  channels: readonly string[];
  /** 建索引的项目：全部，或这些项目 ID（不属于项目的视频只在「全部」时建）。 */
  indexedProjects: 'all' | readonly Id[];
  /** 用电池时暂停（设置 `semantic.pauseOnBattery`，默认是）。 */
  pauseOnBattery?: boolean;
}

export interface SemanticCatalogSource {
  videos(): SpaceVideo[];
  readonly index: Pick<ContentIndex, 'at' | 'pendingCount' | 'listen'> | null;
  readonly scanning: boolean;
}

export interface SemanticCoordinatorOptions {
  store: () => SemanticStore | null;
  catalog: SemanticCatalogSource;
  reader: Pick<ContentReader, 'readContent'> | null;
  scheduler: () => EmbeddingScheduler | null;
  scanner: VectorScanner;
  settings: () => SemanticSettings;
  log: Logger;
  /** 关键帧来源；没有时不建画面索引。 */
  frames?: KeyframeSource;
  /** 内容索引变化后等多久再规划（合并连续的变化）。 */
  debounceMs?: number;
  /** 查供电与散热（`power.ts` 的 `probePower`）；不给时不因供电暂停。 */
  power?: () => Promise<PowerState>;
  /** 有活要干时多久查一次供电。 */
  powerPollMs?: number;
}

const PAUSED_KEY = 'paused';
const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_POWER_POLL_MS = 60_000;

interface Planned {
  dir: string;
  videoId: Id;
  projectId: Id | null;
  /** 重建：不用已有向量。 */
  rebuild: boolean;
}

/** `embeddingKey`（§5.3）：编码实现 + 送进模型的文字摘要。 */
export function embeddingKeyOf(profile: Pick<EmbeddingProfile, 'encoderProfileId' | 'promptPairId'>, text: string): string {
  const payload = formatEmbeddingInput(profile.promptPairId, 'document', { text, title: null });
  return crypto.createHash('sha256').update(`${profile.encoderProfileId}\n${digestText(payload)}`).digest('hex');
}

export class SemanticCoordinator {
  readonly #options: SemanticCoordinatorOptions;
  readonly #queue = new Map<string, Planned>();
  readonly #listeners = new Set<() => void>();
  #unlisten: (() => void) | null = null;
  #timer: NodeJS.Timeout | null = null;
  #worker: Promise<void> | null = null;
  #abort: AbortController | null = null;
  #closed = false;
  /** 最近一次因为模型不可用而停下的原因（`SemanticReason`）；成功编码后清掉。 */
  #blocked: string | null = null;
  readonly #visual: VisualLane | null;
  /** 最近一次查到的供电状态与时间；还没查过时当作接着电。 */
  #power: PowerState = 'ac';
  #powerAt = 0;
  #probing: Promise<void> | null = null;
  #powerTimer: NodeJS.Timeout | null = null;

  constructor(options: SemanticCoordinatorOptions) {
    this.#options = options;
    this.#visual = options.frames
      ? new VisualLane({
          store: options.store,
          catalog: options.catalog,
          reader: options.reader,
          scheduler: options.scheduler,
          scanner: options.scanner,
          settings: options.settings,
          frames: options.frames,
          log: options.log,
          paused: () => this.paused,
          rate: (profile, perUnit) => {
            const store = options.store();
            if (store) recordRate(store, 'visual', profile, perUnit);
          },
          textBusy: () => this.#textBusy,
          changed: () => this.#changed(),
          replan: () => this.schedule(),
        })
      : null;
  }

  /** 画面那一路（没有取帧来源时 null）。 */
  get visual(): Pick<VisualLane, 'running' | 'queued' | 'blockedReason'> | null {
    return this.#visual;
  }

  /** 文字那一路在建，或者还有能建的排着队。 */
  get #textBusy(): boolean {
    return this.#worker !== null || (this.#queue.size > 0 && this.#textEnabled);
  }

  get #textEnabled(): boolean {
    return this.#options.settings().channels.includes('text');
  }

  /** 开始跟随内容索引。 */
  start(): void {
    if (this.#unlisten || this.#closed) return;
    this.#unlisten = this.#options.catalog.index?.listen(() => this.schedule()) ?? null;
    if (this.#options.power) {
      this.#powerTimer = setInterval(() => {
        if (this.#hasWork) void this.#probePower();
      }, this.#pollMs);
      this.#powerTimer.unref?.();
    }
    this.schedule();
  }

  /** 发布、撤下、清理之后通知（检索的游标、状态）。 */
  listen(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 构建停着：用户暂停，或因为供电、温度自动停下。 */
  get paused(): boolean {
    return this.pauseReason !== null;
  }

  /** 为什么停着（`SemanticPauseReason`）：用户暂停优先；没停时 null。 */
  get pauseReason(): 'user' | 'battery' | 'thermal' | null {
    if (this.#userPaused) return 'user';
    this.#refreshPower();
    return this.#powerPause;
  }

  get #userPaused(): boolean {
    return this.#options.store()?.getMeta(PAUSED_KEY) === '1';
  }

  get #powerPause(): 'battery' | 'thermal' | null {
    if (this.#power === 'thermal') return 'thermal';
    if (this.#power === 'battery' && this.#options.settings().pauseOnBattery !== false) return 'battery';
    return null;
  }

  get #pollMs(): number {
    return this.#options.powerPollMs ?? DEFAULT_POWER_POLL_MS;
  }

  /** 有活要干：文字或画面在建、排着队。 */
  get #hasWork(): boolean {
    return this.#worker !== null || this.#queue.size > 0 || (this.#visual !== null && (this.#visual.running || this.#visual.queued > 0));
  }

  /** 上次查供电已经过了一个周期、又有活要干：在后台再查一次（结果变了会停下或接着建）。 */
  #refreshPower(): void {
    if (!this.#options.power || this.#probing || this.#closed) return;
    if (Date.now() - this.#powerAt < this.#pollMs || !this.#hasWork) return;
    void this.#probePower();
  }

  #probePower(): Promise<void> {
    if (!this.#options.power || this.#closed) return Promise.resolve();
    this.#probing ??= this.#options
      .power()
      .catch((): PowerState => 'ac')
      .then((state) => {
        this.#powerAt = Date.now();
        if (state === this.#power) return;
        const before = this.#powerPause;
        this.#power = state;
        const after = this.#powerPause;
        if (before === after) return;
        this.#options.log.info(after ? 'semantic index paused' : 'semantic index resumed', { power: state });
        if (after) {
          this.#abort?.abort();
          this.#visual?.abort();
        } else this.schedule(0);
        this.#changed();
      })
      .finally(() => {
        this.#probing = null;
      });
    return this.#probing;
  }

  /** 设置 `pauseOnBattery` 变了：按手上的供电状态停下或接着建。 */
  powerSettingChanged(): void {
    if (this.#powerPause) {
      this.#abort?.abort();
      this.#visual?.abort();
    } else this.schedule(0);
    this.#changed();
  }

  /** 立刻查一次供电（测试用）。 */
  async checkPower(): Promise<void> {
    await this.#probing;
    this.#powerAt = 0;
    await this.#probePower();
  }

  get running(): boolean {
    return this.#worker !== null;
  }

  /** 排队待建的视频数。 */
  get queued(): number {
    return this.#queue.size;
  }

  get blockedReason(): string | null {
    return this.#blocked;
  }

  pause(): void {
    this.#options.store()?.setMeta(PAUSED_KEY, '1');
    this.#abort?.abort();
    this.#visual?.abort();
  }

  resume(): void {
    this.#options.store()?.setMeta(PAUSED_KEY, null);
    this.schedule(0);
  }

  /** 清掉全部索引与向量；暂停状态保留，没暂停时按当前内容重新排队。 */
  async clear(): Promise<void> {
    this.#abort?.abort();
    this.#queue.clear();
    await this.#worker?.catch(() => {});
    await this.#visual?.clear();
    this.#options.store()?.clear();
    this.#options.scanner.invalidate();
    this.#changed();
    this.schedule(0);
  }

  /**
   * 手动建索引（`space.indexBuild`）：给出的视频（调用方已按主体筛好）排到队首；`rebuild` 时不用已有向量、失败过的也重试。
   * `channels` 含 `visual` 时也建这些视频的画面（不看设置；之后跟着内容变化保持更新）。返回计划处理的视频数（两路取大）。
   */
  build(videos: readonly SpaceVideo[], options: { rebuild?: boolean; channels?: readonly string[] } = {}): number {
    const channels = options.channels ?? ['text'];
    const visual = channels.includes('visual') && this.#visual ? this.#visual.build(videos, { rebuild: options.rebuild === true }) : 0;
    return channels.includes('text') ? Math.max(this.#buildText(videos, options.rebuild === true), visual) : visual;
  }

  #buildText(videos: readonly SpaceVideo[], rebuild: boolean): number {
    const planned: Planned[] = [];
    for (const video of videos) {
      const item = this.#planOne(video, { retryFailed: true, rebuild });
      if (item) planned.push(item);
    }
    const rest = [...this.#queue.values()].filter((item) => !planned.some((p) => p.dir === item.dir));
    this.#queue.clear();
    for (const item of [...planned, ...rest]) this.#queue.set(item.dir, item);
    this.#kick();
    return planned.length;
  }

  /** 内容索引变了：稍后重新规划。 */
  schedule(delayMs = this.#options.debounceMs ?? DEFAULT_DEBOUNCE_MS): void {
    if (this.#closed) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#plan();
    }, delayMs);
    this.#timer.unref?.();
  }

  /** 规划与队列都清空（测试用）。 */
  async idle(): Promise<void> {
    for (;;) {
      if (this.#timer) {
        clearTimeout(this.#timer);
        this.#timer = null;
        this.#plan();
      }
      if (this.#profileCheck) {
        await this.#profileCheck;
        continue;
      }
      if (this.#worker) {
        await this.#worker;
        continue;
      }
      if (!this.#visual?.running) return;
      await this.#visual.idle();
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#powerTimer) clearInterval(this.#powerTimer);
    this.#powerTimer = null;
    this.#unlisten?.();
    this.#unlisten = null;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#queue.clear();
    this.#abort?.abort();
    await this.#worker?.catch(() => {});
    await this.#visual?.close();
  }

  // ---- 规划 ----

  #plan(): void {
    if (this.#closed) return;
    const store = this.#options.store();
    const index = this.#options.catalog.index;
    if (!store || !index) return;
    const videos = this.#options.catalog.videos();
    this.#removeGone(store, index, videos);
    const scheduler = this.#options.scheduler();
    if (!scheduler) return;
    // 换了模型包（profile 变了）而内容没变时也要重建：先按手上的 profile 规划，拿到当前 profile 后不同再规划一次。
    this.#refreshProfile(scheduler);
    for (const video of videos) {
      if (this.#queue.has(video.dir)) continue;
      const item = this.#planOne(video, { retryFailed: false, rebuild: false });
      if (item) this.#queue.set(item.dir, item);
    }
    this.#kick();
    this.#visual?.plan(videos);
  }

  /** 这个视频要不要（重）建；不要时 null。 */
  #planOne(video: SpaceVideo, options: { retryFailed: boolean; rebuild: boolean }): Planned | null {
    const store = this.#options.store();
    const index = this.#options.catalog.index;
    if (!store || !index) return null;
    if (!this.#wantedProject(video.projectId)) return null;
    const indexed = index.at(video.dir);
    // 内容索引还没读到当前版本：等它读完（`listen` 会再叫）。
    if (!indexed || index.pendingCount([video.dir]) > 0) return null;
    const item: Planned = { dir: video.dir, videoId: indexed.videoId, projectId: video.projectId, rebuild: options.rebuild };
    if (options.rebuild) return item;
    const source = store.source(indexed.videoId);
    const generation = store.activeGenerations([indexed.videoId]).get(indexed.videoId) ?? null;
    // 这个版本失败过：等版本变化或手动重建再试。
    if (!options.retryFailed && source?.state === 'failed' && source.wantedRevision === indexed.revision) return null;
    const profileId = this.#profileId;
    const current = generation !== null && generation.revision === indexed.revision && (profileId === null || generation.encoderProfileId === profileId);
    return current ? null : item;
  }

  /** 最近一次拿到的 profile（规划时同步比较用）。 */
  #profileId: string | null = null;
  #profileCheck: Promise<void> | null = null;

  #refreshProfile(scheduler: EmbeddingScheduler): void {
    if (this.#profileCheck) return;
    this.#profileCheck = scheduler
      .profile('retrieval')
      .then(
        (profile) => {
          if (profile.encoderProfileId === this.#profileId) return;
          this.#profileId = profile.encoderProfileId;
          this.#plan();
        },
        () => {},
      )
      .catch((error: unknown) => this.#options.log.warn('semantic index planning failed', { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        this.#profileCheck = null;
      });
  }

  #wantedProject(projectId: Id | null): boolean {
    const settings = this.#options.settings();
    if (settings.indexedProjects === 'all') return true;
    return projectId !== null && settings.indexedProjects.includes(projectId);
  }

  /** 扫描完成、内容索引也都读完之后，库里有、Space 里已经没有的视频撤下。 */
  #removeGone(store: SemanticStore, index: NonNullable<SemanticCatalogSource['index']>, videos: readonly SpaceVideo[]): void {
    if (this.#options.catalog.scanning || index.pendingCount() > 0) return;
    const known = new Set<Id>();
    for (const video of videos) {
      const indexed = index.at(video.dir);
      if (indexed) known.add(indexed.videoId);
    }
    const gone = [...store.sources(), ...store.visualSources()].filter((source) => !known.has(source.videoId));
    if (gone.length === 0) return;
    const generations = gone.map((source) => source.activeGeneration).filter((id): id is number => id !== null);
    store.removeVideos([...new Set(gone.map((source) => source.videoId))]);
    this.#options.scanner.invalidate(generations);
    this.#changed();
  }

  // ---- 执行 ----

  #kick(): void {
    if (this.#worker || this.#closed) return;
    // 第一次开工前先查一次供电：用电池时不先跑一批再停。
    if (this.#options.power && this.#powerAt === 0 && this.#queue.size > 0) {
      void this.#probePower().then(() => this.#kick());
      return;
    }
    if (this.#queue.size === 0 || this.paused || !this.#textEnabled) {
      this.#visual?.kick();
      return;
    }
    this.#worker = this.#drain().finally(() => {
      this.#worker = null;
      this.#abort = null;
      // 文字这一路空了：轮到画面。
      this.#visual?.kick();
    });
  }

  async #drain(): Promise<void> {
    while (!this.#closed && this.#queue.size > 0 && !this.paused) {
      const scheduler = this.#options.scheduler();
      const store = this.#options.store();
      if (!scheduler || !store) return;
      let profile: EmbeddingProfile;
      try {
        profile = await scheduler.profile('retrieval');
      } catch (error) {
        this.#block(error);
        return;
      }
      if (this.#profileId !== profile.encoderProfileId) {
        // profile 变了（换了模型包）：按新的 profile 重新规划一遍。
        this.#profileId = profile.encoderProfileId;
        for (const video of this.#options.catalog.videos()) {
          if (this.#queue.has(video.dir)) continue;
          const item = this.#planOne(video, { retryFailed: false, rebuild: false });
          if (item) this.#queue.set(item.dir, item);
        }
      }
      const item = this.#queue.values().next().value!;
      this.#queue.delete(item.dir);
      this.#abort = new AbortController();
      try {
        await this.#indexOne(store, scheduler, profile, item, this.#abort.signal);
        this.#blocked = null;
      } catch (error) {
        if (this.#abort.signal.aborted) {
          // 暂停或关闭：这一个视频下次再来（已提交的向量会复用）。
          if (!this.#closed) this.#queue.set(item.dir, item);
          return;
        }
        if (error instanceof EmbeddingError && ['MODEL_NOT_INSTALLED', 'MODEL_UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'PROFILE_INCOMPATIBLE'].includes(error.reason)) {
          // 模型整体不可用：停下，不把每个视频都记失败。
          this.#queue.set(item.dir, item);
          this.#block(error);
          return;
        }
        const indexed = this.#options.catalog.index?.at(item.dir);
        if (indexed) {
          store.freeze(indexed.videoId, item.dir, item.projectId, indexed.revision);
          store.markFailed(indexed.videoId, indexed.revision, error instanceof Error ? error.message : String(error));
        }
        this.#options.log.warn('semantic index failed', { dir: item.dir, error: error instanceof Error ? error.message : String(error) });
        this.#changed();
      }
    }
  }

  #block(error: unknown): void {
    this.#blocked = error instanceof EmbeddingError ? error.reason : 'MODEL_UNAVAILABLE';
    this.#options.log.warn('semantic index paused: model unavailable', {
      reason: this.#blocked,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async #indexOne(store: SemanticStore, scheduler: EmbeddingScheduler, profile: EmbeddingProfile, item: Planned, signal: AbortSignal): Promise<void> {
    const reader = this.#options.reader;
    if (!reader) throw new Error('content reader unavailable');
    const content = await reader.readContent(item.dir);
    signal.throwIfAborted();
    const extracted = extractContent(content, item.dir);
    const { expectedGeneration } = store.freeze(content.videoId, item.dir, item.projectId, content.revision);
    const { chunks, sentences } = chunkVideo(content.videoId, extracted.segments);
    const keyed: (ChunkDraft & { embeddingKey: string })[] = chunks.map((chunk) => ({ ...chunk, embeddingKey: embeddingKeyOf(profile, chunk.text) }));
    const keys = [...new Set(keyed.map((c) => c.embeddingKey))];
    const have = item.rebuild ? new Map<string, Float32Array>() : store.embeddings(keys, profile.encoderProfileId, profile.dims);
    const textOf = new Map(keyed.map((c) => [c.embeddingKey, c.text]));
    const missing = keys.filter((key) => !have.has(key));
    let encodeMs = 0;
    for (let i = 0; i < missing.length; i += TEXT_BATCH_MAX) {
      signal.throwIfAborted();
      const batch = missing.slice(i, i + TEXT_BATCH_MAX);
      const started = performance.now();
      const result = await scheduler.embed(
        'retrieval',
        { role: 'document', inputs: batch.map((key) => ({ text: textOf.get(key)!, title: null })) },
        { priority: 'background', signal },
      );
      encodeMs += performance.now() - started;
      if (result.vectors.length !== batch.length) throw new EmbeddingError('MODEL_UNAVAILABLE', 'embedding count mismatch');
      store.putEmbeddings(
        batch.map((key, n) => ({ key, encoderProfileId: profile.encoderProfileId, vector: validVector(result.vectors[n]!, profile.dims) })),
      );
    }
    signal.throwIfAborted();
    // 速度按时间线时长记（估时间时也按它）；大部分句群命中缓存的视频不记。
    const duration = this.#options.catalog.index?.at(item.dir)?.facts.timeline?.durationSec ?? null;
    if (duration && duration > 0 && keys.length > 0 && missing.length >= keys.length * TEXT_RATE_MIN_FRESH) {
      recordRate(store, 'text', profile, encodeMs / 1000 / duration);
    }
    const published = store.publish({
      videoId: content.videoId,
      revision: content.revision,
      expectedGeneration,
      encoderProfileId: profile.encoderProfileId,
      embeddingSpaceId: profile.embeddingSpaceId,
      dims: profile.dims,
      chunks: keyed,
      sentences,
    });
    if (published.published) {
      if (expectedGeneration !== null) this.#options.scanner.invalidate([expectedGeneration]);
      this.#changed();
    } else if (published.reason === 'stale') {
      // 别的构建冻结了更新的版本：它会发布；这里只重新规划一次，确认没有漏掉。
      this.schedule();
    } else if (published.reason === 'missing-vectors') {
      throw new Error('embedding cache lost vectors before publish');
    }
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** 入库前的核对（§18.2）：维度、非有限值、零向量与归一化。 */
export function validVector(vector: Float32Array, dims: number): Float32Array {
  if (vector.length !== dims) throw new EmbeddingError('PROFILE_INCOMPATIBLE', `vector has ${vector.length} dims, expected ${dims}`);
  let sum = 0;
  for (let i = 0; i < dims; i++) {
    const v = vector[i]!;
    if (!Number.isFinite(v)) throw new EmbeddingError('MODEL_UNAVAILABLE', 'embedding has a non-finite value');
    sum += v * v;
  }
  if (Math.abs(Math.sqrt(sum) - 1) > 1e-3) throw new EmbeddingError('MODEL_UNAVAILABLE', 'embedding is not normalized');
  return vector;
}
