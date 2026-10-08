import type { VersionRef } from '@baocut/protocol';
import { RT } from './runtime-copy.ts';

/** 素材字节怎么变成能用的东西（Lottie 动画、频谱……）；`release` 在缓存丢掉它时调用。 */
interface Decoder<T> {
  readonly name: string;
  decode(response: Response): Promise<T>;
  release?(value: T): void;
}

type Entry =
  | { state: 'loading' }
  | { state: 'ready'; value: unknown; release: () => void }
  | { state: 'failed'; message: string; at: number; failures: number; retrying: boolean };

export type AssetState<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; message: string };

/** 取失败之后隔这么久再取，每失败一次翻倍，最多隔一分钟（Runtime 重启时会失败一阵）。 */
const RETRY_MS = 3000;
const RETRY_MAX_MS = 60_000;

export interface AssetCacheOptions {
  fetch?: (url: string) => Promise<Response>;
  now?: () => number;
}

/**
 * 素材内容的缓存：一个素材版本的字节不会再变，按「解码器:素材@版本」记住解出来的东西，预览各处共用。
 * 媒体地址每次取之前现要（句柄有期限）；取到了通知订阅者重画。
 */
export class AssetCache {
  readonly #resolve: (asset: VersionRef) => Promise<string>;
  readonly #fetch: (url: string) => Promise<Response>;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<() => void>();
  #generation = 0;

  constructor(resolve: (asset: VersionRef) => Promise<string>, options: AssetCacheOptions = {}) {
    this.#resolve = resolve;
    this.#fetch = options.fetch ?? ((url) => fetch(url));
    this.#now = options.now ?? (() => performance.now());
  }

  /** 解好的内容；还没有就去取（React 渲染与画帧里都能调）。失败后重试期间仍报失败，不在两种状态间闪。 */
  get<T>(asset: VersionRef, decoder: Decoder<T>): AssetState<T> {
    const k = `${decoder.name}:${asset.id}@${asset.revision}`;
    const entry = this.#entries.get(k);
    if (!entry) this.#load(k, asset, decoder, 0);
    else if (entry.state === 'failed' && !entry.retrying && this.#now() - entry.at >= backoff(entry.failures)) {
      entry.retrying = true;
      this.#load(k, asset, decoder, entry.failures);
    }
    const current = this.#entries.get(k)!;
    if (current.state === 'ready') return { state: 'ready', value: current.value as T };
    if (current.state === 'failed') return { state: 'failed', message: current.message };
    return { state: 'loading' };
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 换了视频：解好的都释放，路上的请求回来也不收。 */
  clear(): void {
    this.#generation++;
    for (const entry of this.#entries.values()) if (entry.state === 'ready') entry.release();
    this.#entries.clear();
  }

  /** 忘掉还在路上的请求（预览卡住时的「重试」）：之后再要就重新发，路上的回来也不收；解好的照留。 */
  forgetPending(): void {
    for (const [k, entry] of [...this.#entries]) {
      if (entry.state === 'loading' || (entry.state === 'failed' && entry.retrying)) this.#entries.delete(k);
    }
  }

  #load<T>(k: string, asset: VersionRef, decoder: Decoder<T>, failures: number): void {
    const generation = this.#generation;
    if (!this.#entries.has(k)) this.#entries.set(k, { state: 'loading' });
    // 路上的这一次：被 `forgetPending` 忘掉（或换成了新的一次）之后回来不收。
    const pending = this.#entries.get(k);
    this.#resolve(asset)
      .then((url) => this.#fetch(url))
      .then((response) => {
        if (!response.ok) throw new Error(RT.mediaStatus(response.status));
        return decoder.decode(response);
      })
      .then(
        (value) => {
          const release = () => decoder.release?.(value);
          if (generation !== this.#generation || this.#entries.get(k) !== pending) release();
          else this.#settle(k, { state: 'ready', value, release });
        },
        (error: unknown) => {
          if (generation !== this.#generation || this.#entries.get(k) !== pending) return;
          const message = error instanceof Error ? error.message : String(error);
          this.#settle(k, { state: 'failed', message, at: this.#now(), failures: failures + 1, retrying: false });
        },
      );
  }

  #settle(k: string, entry: Entry): void {
    this.#entries.set(k, entry);
    for (const listener of this.#listeners) listener();
  }
}

function backoff(failures: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** Math.max(0, failures - 1));
}
