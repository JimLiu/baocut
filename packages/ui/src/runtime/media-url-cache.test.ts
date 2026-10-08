import { describe, expect, it, vi } from 'vitest';
import type { MediaHandle, VersionRef } from '@baocut/protocol';
import { MediaUrlCache } from './media-url-cache.ts';

const asset = { id: 'asset_a', revision: '1' };
const HOUR = 3_600_000;

function setup() {
  let now = Date.parse('2026-10-06T00:00:00Z');
  let serial = 0;
  const pending: { resolve(handle: MediaHandle): void; reject(error: Error): void; progress(progress: number | null): void }[] = [];
  const resolve = vi.fn(
    (_videoId: string, _asset: VersionRef, _signal: AbortSignal, onProgress: (progress: number | null) => void) =>
      new Promise<MediaHandle>((resolve, reject) => pending.push({ resolve, reject, progress: onProgress })),
  );
  const cache = new MediaUrlCache(resolve, { now: () => now });
  /** 一个新句柄：地址每次不同，`ttl` 之后过期。 */
  const handle = (ttl = HOUR): MediaHandle => ({
    url: `http://media/grant-${++serial}`,
    mimeType: 'audio/wav',
    size: 1,
    fileName: 'a.wav',
    expiresAt: new Date(now + ttl).toISOString(),
  });
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { cache, resolve, pending, handle, settle, advance: (ms: number) => (now += ms) };
}

describe('媒体地址缓存', () => {
  it('关视频或重连时终止尚未完成的兼容播放轮询', async () => {
    const cache = new MediaUrlCache((_video, _asset, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const pending = cache.get('vid1', asset);
    const stopped = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    cache.clear();
    await stopped;
    expect(cache.peek('vid1', asset)).toBeNull();
  });
  it('同一刻上千次要同一个素材版本只发一次请求，都拿到同一个地址；取到之后同步可读', async () => {
    const { cache, resolve, pending, handle } = setup();
    const waiters = Array.from({ length: 1000 }, () => cache.get('vid1', asset));
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(cache.peek('vid1', asset)).toBeNull();
    const granted = handle();
    pending[0]!.resolve(granted);
    expect(new Set(await Promise.all(waiters))).toEqual(new Set([granted.url]));
    expect(cache.peek('vid1', asset)).toBe(granted.url);
    expect(await cache.get('vid1', asset)).toBe(granted.url);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('按「视频:素材@版本」分开：换了版本或视频都另要', () => {
    const { cache, resolve } = setup();
    void cache.get('vid1', asset);
    void cache.get('vid1', { id: 'asset_a', revision: '2' });
    void cache.get('vid2', asset);
    void cache.get('vid1', asset);
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it('失败不记：等着的都拿到同一个错误，下一次再要就重新发', async () => {
    const { cache, resolve, pending, handle, settle } = setup();
    const waiters = Array.from({ length: 10 }, () => cache.get('vid1', asset).catch((error: Error) => error));
    const refused = new Error('视频没有打开；先打开它');
    pending[0]!.reject(refused);
    const results = await Promise.all(waiters);
    expect(results.every((result) => result === refused)).toBe(true);
    await settle();
    expect(cache.peek('vid1', asset)).toBeNull();
    const again = cache.get('vid1', asset);
    expect(resolve).toHaveBeenCalledTimes(2);
    const granted = handle();
    pending[1]!.resolve(granted);
    expect(await again).toBe(granted.url);
  });

  it('句柄离过期不到一分钟就不再用，重新要', async () => {
    const { cache, resolve, pending, handle, settle, advance } = setup();
    const first = cache.get('vid1', asset);
    const granted = handle(HOUR);
    pending[0]!.resolve(granted);
    await first;
    advance(HOUR - 61_000);
    expect(cache.peek('vid1', asset)).toBe(granted.url);
    advance(2_000);
    expect(cache.peek('vid1', asset)).toBeNull();
    const refreshed = cache.get('vid1', asset);
    expect(resolve).toHaveBeenCalledTimes(2);
    const next = handle();
    pending[1]!.resolve(next);
    expect(await refreshed).toBe(next.url);
    await settle();
    expect(cache.peek('vid1', asset)).toBe(next.url);
  });

  it('clear 之后路上的请求回来也不收：等它的照样拿到结果，但缓存里没有，下一次另要', async () => {
    const { cache, resolve, pending, handle, settle } = setup();
    const before = cache.get('vid1', asset);
    cache.clear();
    const stale = handle();
    pending[0]!.resolve(stale);
    expect(await before).toBe(stale.url);
    await settle();
    expect(cache.peek('vid1', asset)).toBeNull();
    void cache.get('vid1', asset);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('clear 之后同一个键的新请求先回来、旧请求后回来：留下新的；旧请求失败也不删新的', async () => {
    const { cache, pending, handle, settle } = setup();
    void cache.get('vid1', asset).catch(() => {});
    cache.clear();
    const fresh = cache.get('vid1', asset);
    const granted = handle();
    pending[1]!.resolve(granted);
    await fresh;
    pending[0]!.reject(new Error('Runtime 重启了'));
    await settle();
    expect(cache.peek('vid1', asset)).toBe(granted.url);
  });

  it('invalidate 只在记着的还是放不出的那个地址时才删：先报错的删掉重新要，其余的跟上同一个新请求', async () => {
    const { cache, resolve, pending, handle, settle } = setup();
    const first = cache.get('vid1', asset);
    const dead = handle();
    pending[0]!.resolve(dead);
    await first;

    cache.invalidate('vid1', asset, 'http://media/other');
    expect(cache.peek('vid1', asset)).toBe(dead.url);

    // 上千个元素都在 dead 上报错：第一个删掉并重新要，其余的删不动正在路上的请求，跟上它。
    cache.invalidate('vid1', asset, dead.url);
    const waiters = [cache.get('vid1', asset)];
    for (let i = 0; i < 999; i++) {
      cache.invalidate('vid1', asset, dead.url);
      waiters.push(cache.get('vid1', asset));
    }
    expect(resolve).toHaveBeenCalledTimes(2);
    const next = handle();
    pending[1]!.resolve(next);
    expect(new Set(await Promise.all(waiters))).toEqual(new Set([next.url]));
    await settle();

    // 新地址到了之后迟到的旧报错也删不掉它。
    cache.invalidate('vid1', asset, dead.url);
    expect(cache.peek('vid1', asset)).toBe(next.url);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('预览重试：这部视频取到的与路上的都丢掉、重新要，路上那次迟到也不收；别的视频不动', async () => {
    const { cache, resolve, pending, handle, settle } = setup();
    const other = { id: 'asset_b', revision: '1' };
    void cache.get('vid1', asset);
    void cache.get('vid1', other);
    void cache.get('vid2', asset);
    const kept = handle();
    pending[1]!.resolve(kept);
    pending[2]!.resolve(handle());
    await settle();
    expect(cache.peek('vid1', other)).toBe(kept.url);

    cache.forgetVideo('vid1');
    expect(cache.peek('vid1', other)).toBeNull();
    expect(cache.peek('vid2', asset)).not.toBeNull();
    void cache.get('vid1', asset);
    expect(resolve).toHaveBeenCalledTimes(4);
    // 卡住的那次终于回来了：不收，等的是新的这次。
    pending[0]!.resolve(handle());
    await settle();
    expect(cache.peek('vid1', asset)).toBeNull();
    const fresh = handle();
    pending[3]!.resolve(fresh);
    await settle();
    expect(cache.peek('vid1', asset)).toBe(fresh.url);
  });

  it('转换中：记下路上的请求报的进度并通知；好了、失败了都删掉，不在准备的素材是 undefined', async () => {
    const { cache, pending, handle, settle } = setup();
    const other = { id: 'asset_b', revision: '1' };
    const heard = vi.fn();
    cache.subscribe(heard);
    void cache.get('vid1', asset);
    const failing = cache.get('vid1', other).catch(() => {});
    expect(cache.progress('vid1', asset)).toBeUndefined();
    expect(cache.preparing('vid1')).toEqual([]);

    pending[0]!.progress(null);
    pending[1]!.progress(0.2);
    pending[0]!.progress(0.5);
    // 同样的进度再报一次不再通知。
    pending[0]!.progress(0.5);
    expect(heard).toHaveBeenCalledTimes(3);
    expect(cache.progress('vid1', asset)).toBe(0.5);
    expect(cache.preparing('vid1')).toEqual([
      { assetId: 'asset_a', revision: '1', progress: 0.5 },
      { assetId: 'asset_b', revision: '1', progress: 0.2 },
    ]);
    expect(cache.preparing('vid2')).toEqual([]);

    pending[0]!.resolve(handle());
    pending[1]!.reject(new Error('boom'));
    await failing;
    await settle();
    expect(cache.progress('vid1', asset)).toBeUndefined();
    expect(cache.preparing('vid1')).toEqual([]);
    expect(heard).toHaveBeenCalledTimes(5);
  });

  it('转换中：重试丢掉的请求还在轮询，它报的进度不收；关视频时全部删掉', async () => {
    const { cache, pending } = setup();
    void cache.get('vid1', asset);
    pending[0]!.progress(0.3);
    cache.forgetVideo('vid1');
    expect(cache.progress('vid1', asset)).toBeUndefined();
    void cache.get('vid1', asset);
    pending[0]!.progress(0.4);
    expect(cache.progress('vid1', asset)).toBeUndefined();
    pending[1]!.progress(0.41);
    expect(cache.progress('vid1', asset)).toBe(0.41);
    cache.clear();
    expect(cache.preparing('vid1')).toEqual([]);
  });
});
