import type { Id, MediaHandle, VersionRef } from '@baocut/protocol';

type Entry = { state: 'pending'; promise: Promise<MediaHandle>; generation: number; controller: AbortController } | { state: 'ready'; handle: MediaHandle };

/** 句柄离过期不到这么久就当它已经过期，重新要（与已发送图片的句柄同一个余量）。 */
const FRESH_MARGIN_MS = 60_000;

export interface MediaUrlCacheOptions {
  now?: () => number;
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
 */
export class MediaUrlCache {
  readonly #resolve: (videoId: Id, asset: VersionRef, signal: AbortSignal) => Promise<MediaHandle>;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();
  #generation = 0;

  constructor(resolve: (videoId: Id, asset: VersionRef, signal: AbortSignal) => Promise<MediaHandle>, options: MediaUrlCacheOptions = {}) {
    this.#resolve = resolve;
    this.#now = options.now ?? (() => Date.now());
  }

  /** 已经取到、还没快过期的地址（渲染时同步读）；没有就是 null。 */
  peek(videoId: Id, asset: VersionRef): string | null {
    const entry = this.#entries.get(mediaUrlKey(videoId, asset));
    return entry?.state === 'ready' && this.#fresh(entry.handle) ? entry.handle.url : null;
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
  }

  /** 关掉视频或 Runtime 重新连上：全部丢掉，路上的请求回来也不收。 */
  clear(): void {
    this.#generation++;
    for (const entry of this.#entries.values()) if (entry.state === 'pending') entry.controller.abort();
    this.#entries.clear();
  }

  #load(key: string, videoId: Id, asset: VersionRef): Promise<MediaHandle> {
    const controller = new AbortController();
    const promise = this.#resolve(videoId, asset, controller.signal);
    const entry: Entry = { state: 'pending', promise, generation: this.#generation, controller };
    this.#entries.set(key, entry);
    promise.then(
      (handle) => {
        if (entry.generation === this.#generation && this.#entries.get(key) === entry) this.#entries.set(key, { state: 'ready', handle });
      },
      () => {
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
      },
    );
    return promise;
  }

  #fresh(handle: MediaHandle): boolean {
    return Date.parse(handle.expiresAt) - this.#now() > FRESH_MARGIN_MS;
  }
}
