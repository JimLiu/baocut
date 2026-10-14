import crypto from 'node:crypto';
import { mediaTimeToSeconds, type Id, type VideoSnapshot } from '@baocut/protocol';
import { EmbeddingError, type EmbeddingFrames, type EmbeddingProfile } from '@baocut/models';
import type { Logger } from '@baocut/harness';
import type { SpaceVideo } from '../../space-catalog.ts';
import { assetSegments, projectSourceTime, type AssetSegment } from '../../agent-tools/source-chapters.ts';
import type { ContentReader } from '../content-index.ts';
import { validVector, type SemanticCatalogSource, type SemanticSettings } from './coordinator.ts';
import type { EmbeddingScheduler } from './scheduler.ts';
import type { PublishVisualInput, SemanticStore } from './store.ts';
import type { VectorScanner } from './vector-index.ts';

/**
 * 画面索引的增量构建（检索规格 §6.2、§9；创作辅助集成设计 §3.5）：每个视频里每个视频素材的当前版本，按来源时间每隔
 * `FRAME_INTERVAL_SEC` 秒取一帧关键帧，用多模态模型包的图像编码器编码，作为这个视频的画面世代发布。
 *
 * - 建哪些视频：设置里开了画面通道（`semantic.channels` 含 `visual`）时，按「建索引的项目」全部；没开时只建明确要过的
 *   （`space.indexBuild` 带 `channels: ['visual']`，例如用户在会话里交了素材），要过一次之后跟着内容变化保持更新。
 * - 让文字先建：文字那一路还有活时不开始下一个视频（`textBusy`），文字建完会叫醒这里。
 * - 向量按 `encoderProfileId + 内容哈希 + 毫秒` 寻址：同一份素材在几个视频里只编码一次，素材换了版本才重算；已有向量的帧
 *   不取帧。取不出的帧（解码失败、时间超出）跳过，不让整个视频失败。
 * - 没有能读图的模型包（只装了文字包）时停下，记下原因，不把视频记失败。
 * - 暂停与文字共用（用户的暂停与供电、散热的自动停下）；暂停时手上那一批编码完就停，不发布半成品。
 */

/** 每隔几秒（来源时间）取一帧：G0 多模态评测按 8 秒取帧，CPU 每小时视频约 7.5–9 分钟。 */
export const FRAME_INTERVAL_SEC = 8;
/** 一个素材最多取几帧：更长的素材按时长放宽间隔（4 小时以内仍是每 8 秒）。 */
export const MAX_FRAMES_PER_ASSET = 1800;

/** 取帧要用的素材版本信息。 */
export interface VisualAsset {
  assetId: Id;
  revision: string;
  contentHash: string;
  mediaType: string;
  durationSec: number | null;
}

/** 关键帧的来源（Runtime 里接 `MediaAnalysis.keyframeFile` 与 `VideoService.assetFileAt`）：返回缓存里的图片文件。 */
export interface KeyframeSource {
  keyframe(dir: string, asset: VisualAsset, at: number, frames: EmbeddingFrames): Promise<string>;
}

export interface VisualLaneOptions {
  store: () => SemanticStore | null;
  catalog: SemanticCatalogSource;
  reader: Pick<ContentReader, 'readContent'> | null;
  scheduler: () => EmbeddingScheduler | null;
  scanner: VectorScanner;
  settings: () => SemanticSettings;
  frames: KeyframeSource;
  log: Logger;
  paused: () => boolean;
  /** 记一次实测速度（秒 / 帧，取帧加编码）：`estimate.ts`。 */
  rate?: (profile: EmbeddingProfile, secondsPerFrame: number) => void;
  /** 文字那一路还在建或排着队。 */
  textBusy: () => boolean;
  changed: () => void;
  /** 发布时发现别的构建冻结了更新的版本：重新规划一次。 */
  replan: () => void;
}

interface Planned {
  dir: string;
  videoId: Id;
  rebuild: boolean;
}

/** 画面向量的 `embeddingKey`：编码实现 + 素材内容 + 帧的时间（毫秒）。 */
export function frameKeyOf(encoderProfileId: string, contentHash: string, millis: number): string {
  return crypto.createHash('sha256').update(`${encoderProfileId}\nframe:${contentHash}@${millis}`).digest('hex');
}

/** 一个素材取帧的时刻（来源秒）：每个间隔的中点；时长不知道时只取开头一帧。 */
export function frameTimes(durationSec: number | null): number[] {
  if (!durationSec || !(durationSec > 0)) return [0];
  const interval = Math.max(FRAME_INTERVAL_SEC, durationSec / MAX_FRAMES_PER_ASSET);
  const times: number[] = [];
  for (let at = Math.min(interval / 2, durationSec / 2); at < durationSec; at += interval) times.push(Math.round(at * 1000) / 1000);
  return times;
}

/** 视频里可以取帧的素材：每个素材的当前版本，有画面、媒体类型是视频。图片素材这一版不取（媒体分析只按视频取帧）。 */
export function visualAssetsOf(snapshot: VideoSnapshot): VisualAsset[] {
  const out: VisualAsset[] = [];
  for (const asset of Object.values(snapshot.assets ?? {})) {
    const record = asset.revisions?.[asset.currentRevision];
    if (!record?.video || !record.mediaType.startsWith('video/')) continue;
    out.push({
      assetId: asset.id,
      revision: asset.currentRevision,
      contentHash: record.contentHash,
      mediaType: record.mediaType,
      durationSec: record.duration ? mediaTimeToSeconds(record.duration) : null,
    });
  }
  return out.sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));
}

const MODEL_REASONS = ['MODEL_NOT_INSTALLED', 'MODEL_UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'PROFILE_INCOMPATIBLE'];

export class VisualLane {
  readonly #options: VisualLaneOptions;
  readonly #queue = new Map<string, Planned>();
  #worker: Promise<void> | null = null;
  #abort: AbortController | null = null;
  #closed = false;
  #blocked: string | null = null;
  #profileId: string | null = null;

  constructor(options: VisualLaneOptions) {
    this.#options = options;
  }

  get running(): boolean {
    return this.#worker !== null;
  }

  get queued(): number {
    return this.#queue.size;
  }

  /** 最近一次因为模型不可用而停下的原因；成功编码后清掉。 */
  get blockedReason(): string | null {
    return this.#blocked;
  }

  /** 暂停、清理：停下手上的一批。 */
  abort(): void {
    this.#abort?.abort();
  }

  async clear(): Promise<void> {
    this.#abort?.abort();
    this.#queue.clear();
    await this.#worker?.catch(() => {});
  }

  async idle(): Promise<void> {
    while (this.#worker) await this.#worker;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#queue.clear();
    this.#abort?.abort();
    await this.#worker?.catch(() => {});
  }

  /** 按设置与已经要过的视频规划；`videos` 是 Space 里此刻的视频。 */
  plan(videos: readonly SpaceVideo[]): void {
    if (this.#closed) return;
    const store = this.#options.store();
    if (!store || !this.#options.scheduler()) return;
    const all = this.#options.settings().channels.includes('visual');
    for (const video of videos) {
      if (this.#queue.has(video.dir)) continue;
      const item = this.#planOne(store, video, { all, rebuild: false, explicit: false });
      if (item) this.#queue.set(item.dir, item);
    }
    this.kick();
  }

  /** 明确要建这些视频的画面（`space.indexBuild`）：排到队首，不看设置里开没开画面（项目的纳入照看）。返回计划处理的视频数。 */
  build(videos: readonly SpaceVideo[], options: { rebuild?: boolean } = {}): number {
    const store = this.#options.store();
    if (!store) return 0;
    const planned: Planned[] = [];
    for (const video of videos) {
      const item = this.#planOne(store, video, { all: true, rebuild: options.rebuild === true, explicit: true });
      if (item) planned.push(item);
    }
    const rest = [...this.#queue.values()].filter((item) => !planned.some((p) => p.dir === item.dir));
    this.#queue.clear();
    for (const item of [...planned, ...rest]) this.#queue.set(item.dir, item);
    this.kick();
    return planned.length;
  }

  #planOne(store: SemanticStore, video: SpaceVideo, options: { all: boolean; rebuild: boolean; explicit: boolean }): Planned | null {
    const index = this.#options.catalog.index;
    if (!index) return null;
    const indexed = index.at(video.dir);
    if (!indexed || index.pendingCount([video.dir]) > 0) return null;
    const source = store.visualSource(indexed.videoId);
    // 设置里没纳入语义索引的项目不建（明确要也不建，与讲话一路一样）；没开画面时只跟着要过的视频走。
    if (!this.#wantedProject(video.projectId)) return null;
    if (!options.explicit && !source && !options.all) return null;
    const item: Planned = { dir: video.dir, videoId: indexed.videoId, rebuild: options.rebuild };
    if (options.rebuild) return item;
    if (!options.explicit && source?.state === 'failed' && source.wantedRevision === indexed.revision) return null;
    const generation = store.activeVisualGenerations([indexed.videoId]).get(indexed.videoId) ?? null;
    const profileId = this.#profileId;
    const current = generation !== null && generation.revision === indexed.revision && (profileId === null || generation.encoderProfileId === profileId);
    return current ? null : item;
  }

  #wantedProject(projectId: Id | null): boolean {
    const settings = this.#options.settings();
    if (settings.indexedProjects === 'all') return true;
    return projectId !== null && settings.indexedProjects.includes(projectId);
  }

  kick(): void {
    if (this.#worker || this.#closed || this.#queue.size === 0) return;
    if (this.#options.paused() || this.#options.textBusy()) return;
    this.#worker = this.#drain().finally(() => {
      this.#worker = null;
      this.#abort = null;
    });
  }

  async #drain(): Promise<void> {
    while (!this.#closed && this.#queue.size > 0 && !this.#options.paused() && !this.#options.textBusy()) {
      const scheduler = this.#options.scheduler();
      const store = this.#options.store();
      if (!scheduler || !store) return;
      let profile: EmbeddingProfile;
      try {
        profile = await scheduler.profile('text-to-visual');
        if (!profile.frames) throw new EmbeddingError('PROFILE_INCOMPATIBLE', 'the visual profile has no frame spec');
      } catch (error) {
        this.#block(error);
        return;
      }
      if (this.#profileId !== profile.encoderProfileId) {
        // 换了模型包：已经建好的画面世代按新 profile 重新规划。
        this.#profileId = profile.encoderProfileId;
        const all = this.#options.settings().channels.includes('visual');
        for (const video of this.#options.catalog.videos()) {
          if (this.#queue.has(video.dir)) continue;
          const item = this.#planOne(store, video, { all, rebuild: false, explicit: false });
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
          if (!this.#closed) this.#queue.set(item.dir, item);
          return;
        }
        if (error instanceof EmbeddingError && MODEL_REASONS.includes(error.reason)) {
          this.#queue.set(item.dir, item);
          this.#block(error);
          return;
        }
        const indexed = this.#options.catalog.index?.at(item.dir);
        if (indexed) {
          store.freezeVisual(indexed.videoId, indexed.revision);
          store.markVisualFailed(indexed.videoId, indexed.revision, error instanceof Error ? error.message : String(error));
        }
        this.#options.log.warn('visual index failed', { dir: item.dir, error: error instanceof Error ? error.message : String(error) });
        this.#options.changed();
      }
    }
  }

  #block(error: unknown): void {
    this.#blocked = error instanceof EmbeddingError ? error.reason : 'MODEL_UNAVAILABLE';
    this.#options.log.warn('visual index paused: model unavailable', {
      reason: this.#blocked,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async #indexOne(store: SemanticStore, scheduler: EmbeddingScheduler, profile: EmbeddingProfile, item: Planned, signal: AbortSignal): Promise<void> {
    const reader = this.#options.reader;
    if (!reader) throw new Error('content reader unavailable');
    const frames = profile.frames!;
    const content = await reader.readContent(item.dir);
    signal.throwIfAborted();
    const { expectedGeneration } = store.freezeVisual(content.videoId, content.revision);
    const root = content.snapshot.sequences?.[content.snapshot.rootSequenceId] ?? null;
    const planned: (PublishVisualInput['frames'][number] & { asset: VisualAsset; at: number })[] = [];
    for (const asset of visualAssetsOf(content.snapshot)) {
      // 这一版时间线上的位置跟着世代存（世代就是这个版本的）：检索时不用再读视频；版本变了由 resolveSearchHit 重新投影。
      const segments = root ? assetSegments(root, asset.assetId) : [];
      for (const at of frameTimes(asset.durationSec)) {
        const millis = Math.round(at * 1000);
        planned.push({
          asset,
          at,
          assetId: asset.assetId,
          contentHash: asset.contentHash,
          sourceSec: millis / 1000,
          sequenceSec: sequenceSecOf(segments, millis / 1000),
          embeddingKey: frameKeyOf(profile.encoderProfileId, asset.contentHash, millis),
        });
      }
    }
    const keys = [...new Set(planned.map((f) => f.embeddingKey))];
    const have = item.rebuild ? new Set<string>() : new Set(store.embeddings(keys, profile.encoderProfileId, profile.dims).keys());
    const missing = [...new Map(planned.filter((f) => !have.has(f.embeddingKey)).map((f) => [f.embeddingKey, f])).values()];
    const skipped = new Set<string>();
    for (let i = 0; i < missing.length; i += frames.maxBatch) {
      signal.throwIfAborted();
      const started = performance.now();
      const batch: { key: string; file: string }[] = [];
      for (const frame of missing.slice(i, i + frames.maxBatch)) {
        try {
          batch.push({ key: frame.embeddingKey, file: await this.#options.frames.keyframe(item.dir, frame.asset, frame.at, frames) });
        } catch (error) {
          // 这一帧取不出来（素材文件不在、解码失败）：跳过这一帧。
          skipped.add(frame.embeddingKey);
          this.#options.log.debug?.('keyframe skipped', { dir: item.dir, at: frame.at, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (batch.length === 0) continue;
      signal.throwIfAborted();
      let result;
      try {
        result = await scheduler.embedImages(
          batch.map((b) => b.file),
          frames.maxBatch,
          { priority: 'background', signal },
        );
      } catch (error) {
        // 帧文件在取出与编码之间被清掉：跳过这一批，下次重建再取。
        if (error instanceof EmbeddingError && error.reason === 'SOURCE_MISSING') {
          for (const b of batch) skipped.add(b.key);
          continue;
        }
        throw error;
      }
      if (result.vectors.length !== batch.length) throw new EmbeddingError('MODEL_UNAVAILABLE', 'embedding count mismatch');
      store.putEmbeddings(batch.map((b, n) => ({ key: b.key, encoderProfileId: profile.encoderProfileId, vector: validVector(result.vectors[n]!, profile.dims) })));
      this.#options.rate?.(profile, (performance.now() - started) / 1000 / batch.length);
    }
    signal.throwIfAborted();
    const published = store.publishVisual({
      videoId: content.videoId,
      revision: content.revision,
      expectedGeneration,
      encoderProfileId: profile.encoderProfileId,
      embeddingSpaceId: profile.embeddingSpaceId,
      dims: profile.dims,
      frames: planned
        .filter((f) => !skipped.has(f.embeddingKey))
        .map(({ assetId, contentHash, sourceSec, sequenceSec, embeddingKey }) => ({ assetId, contentHash, sourceSec, sequenceSec, embeddingKey })),
    });
    if (published.published) {
      if (expectedGeneration !== null) this.#options.scanner.invalidate([expectedGeneration]);
      this.#options.changed();
    } else if (published.reason === 'stale') {
      this.#options.replan();
    } else if (published.reason === 'missing-vectors') {
      throw new Error('embedding cache lost vectors before publish');
    }
  }
}

/** 素材源时刻在时间线上的位置（根序列秒，取最早一处）；落在剪掉的部分或素材不在时间线上时 null。 */
export function sequenceSecOf(segments: readonly AssetSegment[], sourceSec: number): number | null {
  if (segments.length === 0) return null;
  const { at, offTimeline } = projectSourceTime(segments, sourceSec);
  return offTimeline ? null : Math.round(at * 1000) / 1000;
}
