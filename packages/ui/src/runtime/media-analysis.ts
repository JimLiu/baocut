import type { MediaPeaks, MediaThumbnail, VersionRef } from '@baocut/protocol';
import { decodePeaks, peakScale } from '../model/clip-media.ts';

/** 解好的波形峰值。`scale` 是显示用的放大倍数（见 `peakScale`）。 */
export interface Peaks {
  binsPerSecond: number;
  peaks: Uint8Array;
  scale: number;
}

export type PeaksState = { state: 'loading' } | { state: 'ready'; value: Peaks } | { state: 'no-audio' } | { state: 'failed' };

export interface MediaAnalysisRequests {
  peaks(asset: VersionRef): Promise<MediaPeaks>;
  thumbnail(asset: VersionRef, at: number): Promise<MediaThumbnail>;
}

export interface MediaAnalysisCacheOptions {
  now?: () => number;
  /** 延后执行（轮询峰值、合并通知）。 */
  schedule?: (run: () => void, ms: number) => void;
  /** 同时在路上的缩略图请求。 */
  concurrency?: number;
  /** 最多记住多少张缩略图（data URL，一张几 KB）。 */
  maxThumbnails?: number;
  /** 排队的缩略图最多这么多：再多就丢掉最早排进来的（还看得见的话下次画的时候再排）。 */
  maxQueue?: number;
}

type PeaksEntry =
  | { state: 'loading' }
  | { state: 'ready'; value: Peaks }
  | { state: 'no-audio' }
  | { state: 'failed'; at: number; failures: number; retrying: boolean };

type ThumbnailEntry =
  | { state: 'queued'; asset: VersionRef; assetKey: string; at: number }
  | { state: 'loading' }
  | { state: 'ready'; url: string }
  | { state: 'failed'; at: number };

/** 峰值失败之后隔这么久再取，每失败一次翻倍，最多隔一分钟（同 `AssetCache`）。 */
const RETRY_MS = 3000;
const RETRY_MAX_MS = 60_000;
/** 一张缩略图失败之后隔这么久才再要。 */
const THUMBNAIL_RETRY_MS = 15_000;
/** 一个素材还一张都没取到就连续失败这么多次，不再给它要缩略图（没有解码器之类）。 */
const THUMBNAIL_DEAD_AFTER = 4;
/** 合并通知：一批缩略图到了只重画一次。 */
const NOTIFY_MS = 30;

/**
 * 素材分析结果的缓存（时间线的波形与胶片条）。结果由 Runtime 算（`media.peaks`、`media.thumbnail`），
 * 素材版本的内容不会再变，按「素材@版本」记住，换视频时清空。
 *
 * - `peaks` / `thumbnail` 在渲染里调：没有就去取，取到了通知订阅者重画。
 * - 峰值没算完时 Runtime 回 `pending`，按它给的间隔再问。
 * - 缩略图后要的先取（滚动之后看得见的那几格），同时只发几个请求；记住的张数有上限，最久没用的先丢。
 */
export class MediaAnalysisCache {
  readonly #requests: MediaAnalysisRequests;
  readonly #now: () => number;
  readonly #schedule: (run: () => void, ms: number) => void;
  readonly #concurrency: number;
  readonly #maxThumbnails: number;
  readonly #maxQueue: number;
  readonly #peaks = new Map<string, PeaksEntry>();
  readonly #thumbnails = new Map<string, ThumbnailEntry>();
  readonly #health = new Map<string, { ok: number; failures: number }>();
  readonly #queue: string[] = [];
  readonly #listeners = new Set<() => void>();
  #running = 0;
  #generation = 0;
  #version = 0;
  #notifying = false;

  constructor(requests: MediaAnalysisRequests, options: MediaAnalysisCacheOptions = {}) {
    this.#requests = requests;
    this.#now = options.now ?? (() => performance.now());
    this.#schedule = options.schedule ?? ((run, ms) => void setTimeout(run, ms));
    this.#concurrency = options.concurrency ?? 3;
    this.#maxThumbnails = options.maxThumbnails ?? 1500;
    this.#maxQueue = options.maxQueue ?? 200;
  }

  /** 素材的波形峰值。 */
  peaks(asset: VersionRef): PeaksState {
    const key = assetKeyOf(asset);
    const entry = this.#peaks.get(key);
    if (!entry) this.#loadPeaks(key, asset, 0);
    else if (entry.state === 'failed' && !entry.retrying && this.#now() - entry.at >= backoff(entry.failures)) {
      entry.retrying = true;
      this.#loadPeaks(key, asset, entry.failures);
    }
    const current = this.#peaks.get(key)!;
    if (current.state === 'ready') return { state: 'ready', value: current.value };
    if (current.state === 'failed') return { state: 'failed' };
    return current.state === 'no-audio' ? { state: 'no-audio' } : { state: 'loading' };
  }

  /** 素材在源时间 `at`（秒）的缩略图地址；还没有时返回 null 并去取。 */
  thumbnail(asset: VersionRef, at: number): string | null {
    const assetKey = assetKeyOf(asset);
    const health = this.#health.get(assetKey);
    if (health && health.ok === 0 && health.failures >= THUMBNAIL_DEAD_AFTER) return null;
    const key = `${assetKey}#${Math.round(at * 1000)}`;
    const entry = this.#thumbnails.get(key);
    if (entry?.state === 'ready') {
      // 最近用过的挪到最后，超出上限时从前面丢。
      this.#thumbnails.delete(key);
      this.#thumbnails.set(key, entry);
      return entry.url;
    }
    if (entry && (entry.state !== 'failed' || this.#now() - entry.at < THUMBNAIL_RETRY_MS)) return null;
    this.#thumbnails.set(key, { state: 'queued', asset, assetKey, at });
    this.#queue.push(key);
    while (this.#queue.length > this.#maxQueue) {
      const dropped = this.#queue.shift()!;
      if (this.#thumbnails.get(dropped)?.state === 'queued') this.#thumbnails.delete(dropped);
    }
    // 渲染里排进来的一批排完再发。
    queueMicrotask(() => this.#pump());
    return null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** 每次通知加一（给 `useSyncExternalStore`）。 */
  version = (): number => this.#version;

  /** 换了视频：都丢掉，路上的请求回来也不收。 */
  clear(): void {
    this.#generation++;
    this.#peaks.clear();
    this.#thumbnails.clear();
    this.#health.clear();
    this.#queue.length = 0;
  }

  #loadPeaks(key: string, asset: VersionRef, failures: number): void {
    const generation = this.#generation;
    if (!this.#peaks.has(key)) this.#peaks.set(key, { state: 'loading' });
    this.#requests.peaks(asset).then(
      (result) => {
        if (generation !== this.#generation) return;
        if (result.status === 'pending') {
          const delay = Math.min(5000, Math.max(250, result.retryAfterMs));
          this.#schedule(() => {
            if (generation === this.#generation) this.#loadPeaks(key, asset, failures);
          }, delay);
          return;
        }
        if (result.status === 'no-audio') this.#peaks.set(key, { state: 'no-audio' });
        else {
          const peaks = decodePeaks(result.peaks);
          this.#peaks.set(key, { state: 'ready', value: { binsPerSecond: result.binsPerSecond, peaks, scale: peakScale(peaks) } });
        }
        this.#notify();
      },
      () => {
        if (generation !== this.#generation) return;
        this.#peaks.set(key, { state: 'failed', at: this.#now(), failures: failures + 1, retrying: false });
        this.#notify();
      },
    );
  }

  #pump(): void {
    while (this.#running < this.#concurrency && this.#queue.length) {
      const key = this.#queue.pop()!;
      const entry = this.#thumbnails.get(key);
      if (entry?.state !== 'queued') continue;
      const { asset, assetKey, at } = entry;
      const generation = this.#generation;
      this.#thumbnails.set(key, { state: 'loading' });
      this.#running++;
      this.#requests
        .thumbnail(asset, at)
        .then(
          (result) => {
            if (generation !== this.#generation) return;
            this.#thumbnails.set(key, { state: 'ready', url: `data:${result.mimeType};base64,${result.data}` });
            this.#healthOf(assetKey).ok++;
            this.#evict();
          },
          () => {
            if (generation !== this.#generation) return;
            this.#thumbnails.set(key, { state: 'failed', at: this.#now() });
            this.#healthOf(assetKey).failures++;
          },
        )
        .finally(() => {
          this.#running--;
          this.#notify();
          this.#pump();
        });
    }
  }

  #healthOf(assetKey: string): { ok: number; failures: number } {
    let health = this.#health.get(assetKey);
    if (!health) this.#health.set(assetKey, (health = { ok: 0, failures: 0 }));
    return health;
  }

  #evict(): void {
    if (this.#thumbnails.size <= this.#maxThumbnails) return;
    for (const [key, entry] of this.#thumbnails) {
      if (this.#thumbnails.size <= this.#maxThumbnails) break;
      if (entry.state === 'ready' || entry.state === 'failed') this.#thumbnails.delete(key);
    }
  }

  #notify(): void {
    if (this.#notifying) return;
    this.#notifying = true;
    this.#schedule(() => {
      this.#notifying = false;
      this.#version++;
      for (const listener of this.#listeners) listener();
    }, NOTIFY_MS);
  }
}

function assetKeyOf(asset: VersionRef): string {
  return `${asset.id}@${asset.revision}`;
}

function backoff(failures: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** Math.max(0, failures - 1));
}
