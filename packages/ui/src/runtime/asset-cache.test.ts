import { describe, expect, it, vi } from 'vitest';
import { AssetCache } from './asset-cache.ts';

const asset = { id: 'asset_a', revision: '1' };

function setup() {
  let now = 0;
  const pending: { resolve(response: Response): void; reject(error: Error): void }[] = [];
  const resolveUrl = vi.fn(async () => 'http://media/a');
  const fetch = vi.fn((_url: string) => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject })));
  const cache = new AssetCache(resolveUrl, { fetch, now: () => now });
  const released: string[] = [];
  const decoder = { name: 'text', decode: (response: Response) => response.text(), release: (value: string) => released.push(value) };
  const listener = vi.fn();
  cache.subscribe(listener);
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { cache, decoder, fetch, pending, released, listener, settle, advance: (ms: number) => (now += ms) };
}

describe('素材缓存', () => {
  it('同一个素材只取一次，取到之后通知', async () => {
    const { cache, decoder, fetch, pending, listener, settle } = setup();
    expect(cache.get(asset, decoder)).toEqual({ state: 'loading' });
    expect(cache.get(asset, decoder)).toEqual({ state: 'loading' });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    pending[0]!.resolve(new Response('lottie'));
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cache.get(asset, decoder)).toEqual({ state: 'ready', value: 'lottie' });
  });

  it('失败了报失败；隔一阵才重取，重取期间仍报失败，间隔逐次翻倍', async () => {
    const { cache, decoder, fetch, pending, settle, advance } = setup();
    cache.get(asset, decoder);
    await settle();
    pending[0]!.resolve(new Response('', { status: 404 }));
    await settle();
    expect(cache.get(asset, decoder)).toEqual({ state: 'failed', message: '媒体服务返回 404' });
    advance(2999);
    cache.get(asset, decoder);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(1);
    expect(cache.get(asset, decoder).state).toBe('failed');
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    pending[1]!.reject(new Error('断开了'));
    await settle();
    expect(cache.get(asset, decoder)).toEqual({ state: 'failed', message: '断开了' });
    advance(3000);
    cache.get(asset, decoder);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    advance(3000);
    cache.get(asset, decoder);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    pending[2]!.resolve(new Response('ok'));
    await settle();
    expect(cache.get(asset, decoder)).toEqual({ state: 'ready', value: 'ok' });
  });

  it('换视频时释放解好的内容；路上的请求回来也只释放、不收', async () => {
    const { cache, decoder, pending, released, settle } = setup();
    cache.get(asset, decoder);
    cache.get({ id: 'asset_b', revision: '1' }, decoder);
    await settle();
    pending[0]!.resolve(new Response('a'));
    await settle();
    cache.clear();
    expect(released).toEqual(['a']);
    pending[1]!.resolve(new Response('b'));
    await settle();
    expect(released).toEqual(['a', 'b']);
    expect(cache.get({ id: 'asset_b', revision: '1' }, decoder)).toEqual({ state: 'loading' });
  });

  it('预览重试：忘掉路上的请求、再要就重新取，迟到的只释放不收；解好的照留', async () => {
    const { cache, decoder, fetch, pending, released, settle } = setup();
    const ready = { id: 'asset_b', revision: '1' };
    cache.get(asset, decoder);
    cache.get(ready, decoder);
    await settle();
    pending[1]!.resolve(new Response('b'));
    await settle();

    cache.forgetPending();
    expect(cache.get(ready, decoder)).toEqual({ state: 'ready', value: 'b' });
    expect(cache.get(asset, decoder)).toEqual({ state: 'loading' });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    pending[0]!.resolve(new Response('late'));
    await settle();
    expect(released).toEqual(['late']);
    expect(cache.get(asset, decoder)).toEqual({ state: 'loading' });
    pending[2]!.resolve(new Response('a'));
    await settle();
    expect(cache.get(asset, decoder)).toEqual({ state: 'ready', value: 'a' });
  });
});
