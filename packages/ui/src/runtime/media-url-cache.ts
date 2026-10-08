import type { Id, MediaHandle, VersionRef } from '@baocut/protocol';

type Entry = { state: 'pending'; promise: Promise<MediaHandle>; generation: number; controller: AbortController } | { state: 'ready'; handle: MediaHandle };

/** 句柄离过期不到这么久就当它已经过期，重新要（与已发送图片的句柄同一个余量）。 */
const FRESH_MARGIN_MS = 60_000;

export interface MediaUrlCacheOptions {
  now?: () => number;
}

/** 取地址：`onProgress` 在 Runtime 准备兼容副本的每次轮询时报编码到了几成（0–1，还不知道时 null）。 */
export type ResolveMedia = (videoId: Id, asset: VersionRef, signal: AbortSignal, onProgress: (progress: number | null) => void) => Promise<MediaHandle>;

/** 一个正在准备兼容副本的素材（产品设计 §5.1「预览载入与卡住」的转换中）。 */
export interface MediaPreparation {
  assetId: Id;
  revision: string;
  /** 编码到了几成（0–1）；Runtime 还不知道时是 null。 */
  progress: number | null;
}

/** 缓存的键：「视频:素材@版本」。 */
export function mediaUrlKey(videoId: Id, asset: VersionRef): string {
  return `${videoId}:${asset.id}@${asset.revision}`;
}

/**
 * 当前视频素材的媒体地址（`media.resolve` 的句柄），按「视频:素材@版本」记住，预览、素材面板与素材预览共用。
 * 时间线上上千个配音块常是同一个素材：同一刻挂上的元素只发一次请求（记住的是路上的请求，不只是结果）。
 *
 * - 失败不记：路上的请求失败时删掉，等着它的都拿到同一个错误，下一次再要就重新发。
 * - 句柄离过期不到一分钟就不再用，重新要。
 * - 某个地址放不出来时 `invalidate` 只在记着的还是这个地址时才删（先报错的那个删掉并重新要，其余的跟上新的请求）。
 * - 关掉视频、Runtime 重新连上（旧句柄随 Runtime 一起失效）时 `clear`，路上的请求回来也不收。
 * - 路上的请求在等 Runtime 准备兼容副本时记下进度（`progress`、`preparing`），变了通知订阅者；请求了结、被丢掉时一并删掉。
 *   被丢掉的请求还在轮询，它报的进度不收。
 */
export class MediaUrlCache {
  readonly #resolve: ResolveMedia;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();
  /** 正在准备兼容副本的（键同 `#entries`），按开始准备的先后。 */
  readonly #preparing = new Map<string, MediaPreparation & { videoId: Id }>();
  readonly #listeners = new Set<() => void>();
  #generation = 0;

  constructor(resolve: ResolveMedia, options: MediaUrlCacheOptions = {}) {
    this.#resolve = resolve;
    this.#now = options.now ?? (() => Date.now());
  }

  /** 已经取到、还没快过期的地址（渲染时同步读）；没有就是 null。 */
  peek(videoId: Id, asset: VersionRef): string | null {
    const entry = this.#entries.get(mediaUrlKey(videoId, asset));
    return entry?.state === 'ready' && this.#fresh(entry.handle) ? entry.handle.url : null;
  }

  /** 这个素材的兼容副本编码到了几成（0–1，Runtime 还不知道时 null）；不在准备是 undefined。 */
  progress(videoId: Id, asset: VersionRef): number | null | undefined {
    return this.#preparing.get(mediaUrlKey(videoId, asset))?.progress;
  }

  /** 这部视频正在准备兼容副本的素材，按开始准备的先后。 */
  preparing(videoId: Id): MediaPreparation[] {
    return [...this.#preparing.values()]
      .filter((p) => p.videoId === videoId)
      .map(({ assetId, revision, progress }) => ({ assetId, revision, progress }));
  }

  /** 准备进度变了（开始、推进、了结、被丢掉）时通知；返回取消订阅的函数。 */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 地址：有新鲜的直接给；有路上的请求就等它；否则发一个。 */
  async get(videoId: Id, asset: VersionRef): Promise<string> {
    const key = mediaUrlKey(videoId, asset);
    const entry = this.#entries.get(key);
    if (entry?.state === 'ready' && this.#fresh(entry.handle)) return entry.handle.url;
    if (entry?.state === 'pending') return (await entry.promise).url;
    return (await this.#load(key, videoId, asset)).url;
  }

  /** 媒体元素放不出 `failedUrl`：记着的还是它才删掉；已经换了新地址或正在重新要时不动。 */
  invalidate(videoId: Id, asset: VersionRef, failedUrl: string): void {
    const key = mediaUrlKey(videoId, asset);
    const entry = this.#entries.get(key);
    if (entry?.state === 'ready' && entry.handle.url === failedUrl) this.#entries.delete(key);
  }

  /**
   * 预览卡住时的「重试」：这部视频记着的地址（取到的与路上的）全部丢掉，之后再要就重新发，路上的回来也不收。
   * 已经挂着的媒体元素照用手上的地址，不受影响。
   */
  forgetVideo(videoId: Id): void {
    const prefix = `${videoId}:`;
    for (const key of [...this.#entries.keys()]) if (key.startsWith(prefix)) this.#entries.delete(key);
    let dropped = false;
    for (const key of [...this.#preparing.keys()]) if (key.startsWith(prefix)) dropped = this.#preparing.delete(key) || dropped;
    if (dropped) this.#emit();
  }

  /** 关掉视频或 Runtime 重新连上：全部丢掉，路上的请求回来也不收。 */
  clear(): void {
    this.#generation++;
    for (const entry of this.#entries.values()) if (entry.state === 'pending') entry.controller.abort();
    this.#entries.clear();
    if (this.#preparing.size > 0) {
      this.#preparing.clear();
      this.#emit();
    }
  }

  #load(key: string, videoId: Id, asset: VersionRef): Promise<MediaHandle> {
    const controller = new AbortController();
    let entry: Entry | null = null;
    // 只收还记着的这一个请求报的进度：被丢掉的请求还在轮询。
    const onProgress = (progress: number | null) => {
      if (!entry || this.#entries.get(key) !== entry) return;
      const known = this.#preparing.get(key);
      if (known && known.progress === progress) return;
      this.#preparing.set(key, { videoId, assetId: asset.id, revision: asset.revision, progress });
      this.#emit();
    };
    const promise = this.#resolve(videoId, asset, controller.signal, onProgress);
    const current: Entry = { state: 'pending', promise, generation: this.#generation, controller };
    entry = current;
    this.#entries.set(key, current);
    const settle = () => {
      if (this.#entries.get(key) === current && this.#preparing.delete(key)) this.#emit();
    };
    promise.then(
      (handle) => {
        settle();
        if (current.generation === this.#generation && this.#entries.get(key) === current) this.#entries.set(key, { state: 'ready', handle });
      },
      () => {
        settle();
        if (this.#entries.get(key) === current) this.#entries.delete(key);
      },
    );
    return promise;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  #fresh(handle: MediaHandle): boolean {
    return Date.parse(handle.expiresAt) - this.#now() > FRESH_MARGIN_MS;
  }
}
