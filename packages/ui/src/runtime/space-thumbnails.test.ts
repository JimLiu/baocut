import { describe, expect, it, vi } from 'vitest';
import { RpcError, type SpaceThumbnail } from '@baocut/protocol';
import { SpaceThumbnailCache, type SpaceThumbnailCacheOptions } from './space-thumbnails.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const picture = (data: string): SpaceThumbnail => ({
  kind: 'image',
  mimeType: 'image/jpeg',
  data,
  width: 320,
  height: 180,
});

/** 手动推进的定时器：重试、复查与合并通知都排在这里。 */
function harness(request: (entryId: string) => Promise<SpaceThumbnail>, options: SpaceThumbnailCacheOptions = {}) {
  let now = 0;
  let timers: { at: number; run: () => void }[] = [];
  const cache = new SpaceThumbnailCache(request, {
    schedule: (run, ms) => void timers.push({ at: now + ms, run }),
    ...options,
  });
  const advance = async (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    for (const timer of due) timer.run();
    await settle();
  };
  return { cache, advance };
}

describe('Space 缩略图缓存', () => {
  it('挂上才取，取到了通知并记住；同一份结果返回同一个对象', async () => {
    const request = vi.fn(async (id: string) => picture(id));
    const { cache, advance } = harness(request);
    const listener = vi.fn();
    cache.subscribe(listener);

    expect(cache.peek('a')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    cache.retain('a', 'image', 'v1');
    await settle();
    expect(request).toHaveBeenCalledWith('a');
    await advance(30);
    expect(listener).toHaveBeenCalledTimes(1);
    const first = cache.peek('a');
    expect(first).toEqual({
      kind: 'image',
      url: 'data:image/jpeg;base64,a',
      width: 320,
      height: 180,
    });
    expect(cache.peek('a')).toBe(first);

    // 卸下再挂上、版本没变：不再取。
    cache.retain('a', 'image', 'v1');
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('同时只发几个，后挂上的先取；滚走了还在排队的不发', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<SpaceThumbnail>>>();
    const request = vi.fn((id: string) => {
      const d = deferred<SpaceThumbnail>();
      pending.set(id, d);
      return d.promise;
    });
    const { cache } = harness(request, { concurrency: 2 });
    const releases = ['a', 'b', 'c', 'd', 'e'].map((id) => cache.retain(id, 'image', 'v1'));
    await settle();
    expect(request.mock.calls.map(([id]) => id)).toEqual(['e', 'd']);

    releases[2]!(); // c 滚走了
    pending.get('e')!.resolve(picture('e'));
    pending.get('d')!.resolve(picture('d'));
    await settle();
    expect(request.mock.calls.map(([id]) => id)).toEqual(['e', 'd', 'b', 'a']);

    // 重新挂上 c 才去取。
    cache.retain('c', 'image', 'v1');
    pending.get('b')!.resolve(picture('b'));
    await settle();
    expect(request.mock.calls.map(([id]) => id)).toEqual(['e', 'd', 'b', 'a', 'c']);
  });

  it('会话卡和 Space 共用一次请求；一处卸下后另一处仍能等到视频封面', async () => {
    let ready = false;
    const request = vi.fn(async (): Promise<SpaceThumbnail> => (ready ? picture('poster') : { kind: 'none' }));
    const { cache, advance } = harness(request);
    const releaseCard = cache.retain('video', 'video', 'v1');
    const releaseSpace = cache.retain('video', 'video', 'v1');
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(cache.peek('video')).toEqual({ kind: 'none' });

    releaseSpace();
    ready = true;
    await advance(20_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(cache.peek('video')).toMatchObject({ kind: 'image', url: 'data:image/jpeg;base64,poster' });
    releaseCard();
  });

  it('排队超过上限时丢掉最早排进来的', async () => {
    const gate = deferred<SpaceThumbnail>();
    const request = vi.fn((id: string) => (id === 'busy' ? gate.promise : Promise.resolve(picture(id))));
    const { cache } = harness(request, { concurrency: 1, maxQueue: 2 });
    cache.retain('busy', 'image', 'v1');
    await settle();
    for (const id of ['a', 'b', 'c']) cache.retain(id, 'image', 'v1');
    gate.resolve(picture('busy'));
    await settle();
    expect(request.mock.calls.map(([id]) => id)).toEqual(['busy', 'c', 'b']);
  });

  it('版本变了重取，新的到之前先画旧的', async () => {
    let n = 0;
    const gate = deferred<SpaceThumbnail>();
    const request = vi.fn(async () => (++n === 1 ? picture('old') : gate.promise));
    const { cache } = harness(request);
    const release = cache.retain('a', 'video', 'v1');
    await settle();
    const old = cache.peek('a');
    release();

    cache.retain('a', 'video', 'v2');
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(cache.peek('a')).toBe(old);
    gate.resolve(picture('new'));
    await settle();
    expect(cache.peek('a')).toMatchObject({
      url: 'data:image/jpeg;base64,new',
    });
  });

  it('not-found 与 forbidden 当作没有，不重试', async () => {
    const request = vi.fn(async (id: string): Promise<SpaceThumbnail> => {
      throw new RpcError(id === 'gone' ? 'not-found' : 'forbidden', 'no');
    });
    const { cache, advance } = harness(request);
    cache.retain('gone', 'image', 'v1');
    cache.retain('hidden', 'image', 'v1');
    await settle();
    await advance(120_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(cache.peek('gone')).toEqual({ kind: 'none' });
    expect(cache.peek('hidden')).toEqual({ kind: 'none' });
  });

  it('其余失败立刻再要一次（超时之后 Runtime 已经缓存），之后退避，几次都不行就放弃', async () => {
    const request = vi.fn(async (): Promise<SpaceThumbnail> => {
      throw new RpcError('internal', '请求超时：space.thumbnail');
    });
    const { cache, advance } = harness(request);
    cache.retain('a', 'video-file', 'v1');
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    await advance(14_999);
    expect(request).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(request).toHaveBeenCalledTimes(3);
    await advance(30_000);
    expect(request).toHaveBeenCalledTimes(4);
    await advance(600_000);
    expect(request).toHaveBeenCalledTimes(4);
    expect(cache.peek('a')).toBeNull();

    // 条目变了再试。
    cache.retain('a', 'video-file', 'v2');
    await settle();
    expect(request).toHaveBeenCalledTimes(6);
  });

  it('重新连上之后，断开期间放弃了的再要；拿到了的不重取', async () => {
    let connected = false;
    const request = vi.fn(async (id: string): Promise<SpaceThumbnail> => {
      if (!connected && id === 'a') throw new RpcError('internal', '与 Runtime 的连接已断开');
      return picture(id);
    });
    const { cache, advance } = harness(request);
    cache.retain('ok', 'image', 'v1');
    await settle();
    cache.retain('a', 'image', 'v1');
    await settle();
    await advance(15_000);
    await advance(30_000);
    expect(request.mock.calls.filter(([id]) => id === 'a')).toHaveLength(4);
    expect(cache.peek('a')).toBeNull();

    connected = true;
    cache.revive();
    await settle();
    expect(request.mock.calls.filter(([id]) => id === 'a')).toHaveLength(5);
    expect(request.mock.calls.filter(([id]) => id === 'ok')).toHaveLength(1);
    expect(cache.peek('a')).toMatchObject({ kind: 'image' });
  });

  it('超时后立刻再要一次就拿到', async () => {
    let n = 0;
    const request = vi.fn(async () => {
      if (++n === 1) throw new RpcError('internal', '请求超时：space.thumbnail');
      return picture('a');
    });
    const { cache } = harness(request);
    cache.retain('a', 'export', 'v1');
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(cache.peek('a')).toMatchObject({ kind: 'image' });
  });

  it('视频答 none（内容索引还没追平）时隔一阵复查，最多两次；其他类型不复查', async () => {
    const answers: SpaceThumbnail[] = [{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }];
    const request = vi.fn(async (id: string) => (id === 'doc' ? ({ kind: 'none' } as const) : answers.shift()!));
    const { cache, advance } = harness(request);
    cache.retain('v', 'video', 'v1');
    cache.retain('doc', 'document', 'v1');
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    await advance(20_000);
    expect(request).toHaveBeenCalledTimes(3);
    await advance(20_000);
    expect(request).toHaveBeenCalledTimes(4);
    await advance(60_000);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.filter(([id]) => id === 'doc')).toHaveLength(1);
  });

  it('记住的条目有上限，最久没用、没挂着的先丢', async () => {
    const request = vi.fn(async (id: string) => picture(id));
    const { cache } = harness(request, { maxEntries: 2 });
    const releaseA = cache.retain('a', 'image', 'v1');
    await settle();
    releaseA();
    const releaseB = cache.retain('b', 'image', 'v1');
    await settle();
    releaseB();
    cache.retain('a', 'image', 'v1'); // a 又用到了
    cache.retain('c', 'image', 'v1');
    await settle();
    expect(cache.peek('a')).not.toBeNull();
    expect(cache.peek('b')).toBeNull();
    expect(cache.peek('c')).not.toBeNull();
  });

  it('clear 之后路上的请求回来也不收', async () => {
    const gate = deferred<SpaceThumbnail>();
    const { cache } = harness(() => gate.promise);
    cache.retain('a', 'image', 'v1');
    await settle();
    cache.clear();
    gate.resolve(picture('a'));
    await settle();
    expect(cache.peek('a')).toBeNull();
  });
});
