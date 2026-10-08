import { describe, expect, it, vi } from 'vitest';
import type { MediaPeaks, MediaThumbnail, VersionRef } from '@baocut/protocol';
import { MediaAnalysisCache } from './media-analysis.ts';

const clip: VersionRef = { id: 'asset_a', revision: '1' };
const other: VersionRef = { id: 'asset_b', revision: '1' };

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
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** 手动推进的定时器：轮询与合并通知都排在这里。 */
function harness(
  requests: { peaks?: (asset: VersionRef) => Promise<MediaPeaks>; thumbnail?: (asset: VersionRef, at: number) => Promise<MediaThumbnail> },
  options = {},
) {
  let now = 0;
  let timers: { at: number; run: () => void }[] = [];
  const cache = new MediaAnalysisCache(
    {
      peaks: requests.peaks ?? (async () => ({ status: 'no-audio' })),
      thumbnail: requests.thumbnail ?? (async (_asset, at) => ({ mimeType: 'image/jpeg', data: `t${at}`, at })),
    },
    { now: () => now, schedule: (run, ms) => void timers.push({ at: now + ms, run }), ...options },
  );
  const advance = async (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    for (const timer of due) timer.run();
    await settle();
  };
  return { cache, advance };
}

describe('素材分析缓存：峰值', () => {
  it('pending 时按 Runtime 给的间隔再问，算好之后解码并通知', async () => {
    const answers: MediaPeaks[] = [
      { status: 'pending', retryAfterMs: 1000 },
      { status: 'ready', binsPerSecond: 50, peaks: btoa(String.fromCharCode(10, 64, 32)) },
    ];
    const peaks = vi.fn(async () => answers.shift()!);
    const { cache, advance } = harness({ peaks });
    const listener = vi.fn();
    cache.subscribe(listener);

    expect(cache.peaks(clip)).toEqual({ state: 'loading' });
    await settle();
    expect(cache.peaks(clip)).toEqual({ state: 'loading' });
    expect(peaks).toHaveBeenCalledTimes(1);
    await advance(999);
    expect(peaks).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(peaks).toHaveBeenCalledTimes(2);
    await advance(30);
    expect(listener).toHaveBeenCalledTimes(1);
    const state = cache.peaks(clip);
    if (state.state !== 'ready') throw new Error(state.state);
    expect([...state.value.peaks]).toEqual([10, 64, 32]);
    expect(state.value.binsPerSecond).toBe(50);
    // 三格时第 98 百分位落在中间那格。
    expect(state.value.scale).toBeCloseTo(255 / 32);
    expect(peaks).toHaveBeenCalledTimes(2);
  });

  it('没有声音的素材记住结果，不再问', async () => {
    const peaks = vi.fn(async (): Promise<MediaPeaks> => ({ status: 'no-audio' }));
    const { cache } = harness({ peaks });
    cache.peaks(clip);
    await settle();
    expect(cache.peaks(clip)).toEqual({ state: 'no-audio' });
    cache.peaks(clip);
    expect(peaks).toHaveBeenCalledTimes(1);
  });

  it('失败之后隔一阵才重取，间隔逐次翻倍', async () => {
    const peaks = vi.fn(async (): Promise<MediaPeaks> => {
      throw new Error('引擎重启中');
    });
    const { cache, advance } = harness({ peaks });
    cache.peaks(clip);
    await settle();
    expect(cache.peaks(clip)).toEqual({ state: 'failed' });
    await advance(2999);
    cache.peaks(clip);
    expect(peaks).toHaveBeenCalledTimes(1);
    await advance(1);
    cache.peaks(clip);
    await settle();
    expect(peaks).toHaveBeenCalledTimes(2);
    await advance(3000);
    cache.peaks(clip);
    expect(peaks).toHaveBeenCalledTimes(2);
    await advance(3000);
    cache.peaks(clip);
    expect(peaks).toHaveBeenCalledTimes(3);
  });

  it('换视频之后路上的结果不收，轮询也停下', async () => {
    const answer = deferred<MediaPeaks>();
    const peaks = vi.fn(() => answer.promise);
    const { cache, advance } = harness({ peaks });
    cache.peaks(clip);
    cache.clear();
    answer.resolve({ status: 'pending', retryAfterMs: 500 });
    await advance(1000);
    expect(peaks).toHaveBeenCalledTimes(1);
  });
});

describe('素材分析缓存：缩略图', () => {
  it('同一格只要一次；取到之后是 data URL', async () => {
    const thumbnail = vi.fn(async (_asset: VersionRef, at: number): Promise<MediaThumbnail> => ({
      mimeType: 'image/jpeg',
      data: 'AAAA',
      at,
    }));
    const { cache } = harness({ thumbnail });
    expect(cache.thumbnail(clip, 1.5)).toBeNull();
    expect(cache.thumbnail(clip, 1.5)).toBeNull();
    await settle();
    expect(thumbnail).toHaveBeenCalledTimes(1);
    expect(thumbnail).toHaveBeenCalledWith(clip, 1.5);
    expect(cache.thumbnail(clip, 1.5)).toBe('data:image/jpeg;base64,AAAA');
  });

  it('同时只发几个请求，后要的先取', async () => {
    const pending = new Map<number, ReturnType<typeof deferred<MediaThumbnail>>>();
    const thumbnail = vi.fn((_asset: VersionRef, at: number) => {
      const answer = deferred<MediaThumbnail>();
      pending.set(at, answer);
      return answer.promise;
    });
    const { cache } = harness({ thumbnail }, { concurrency: 2 });
    for (const at of [1, 2, 3, 4]) cache.thumbnail(clip, at);
    await settle();
    expect(thumbnail.mock.calls.map(([, at]) => at)).toEqual([4, 3]);
    pending.get(4)!.resolve({ mimeType: 'image/jpeg', data: 'x', at: 4 });
    await settle();
    expect(thumbnail.mock.calls.map(([, at]) => at)).toEqual([4, 3, 2]);
  });

  it('排队太长时丢掉最早排进来的，下次画到时再排', async () => {
    const pending = new Map<number, ReturnType<typeof deferred<MediaThumbnail>>>();
    const thumbnail = vi.fn((_asset: VersionRef, at: number) => {
      const answer = deferred<MediaThumbnail>();
      pending.set(at, answer);
      return answer.promise;
    });
    const { cache } = harness({ thumbnail }, { concurrency: 1, maxQueue: 2 });
    for (const at of [1, 2, 3]) cache.thumbnail(clip, at);
    await settle();
    expect(thumbnail.mock.calls.map(([, at]) => at)).toEqual([3]);
    // 1 被丢掉之后重新排进来；2 还在队里，不重复排。
    cache.thumbnail(clip, 1);
    cache.thumbnail(clip, 2);
    for (const at of [3, 1, 2]) {
      pending.get(at)?.resolve({ mimeType: 'image/jpeg', data: 'x', at });
      await settle();
    }
    expect(thumbnail.mock.calls.map(([, at]) => at)).toEqual([3, 1, 2]);
  });

  it('一张都没取到就连续失败几次的素材不再要；别的素材不受影响', async () => {
    const thumbnail = vi.fn(async (asset: VersionRef, at: number): Promise<MediaThumbnail> => {
      if (asset.id === clip.id) throw new Error('解不了');
      return { mimeType: 'image/jpeg', data: 'ok', at };
    });
    const { cache } = harness({ thumbnail });
    for (const at of [1, 2, 3, 4]) cache.thumbnail(clip, at);
    await settle();
    cache.thumbnail(clip, 5);
    await settle();
    expect(thumbnail).toHaveBeenCalledTimes(4);
    cache.thumbnail(other, 1);
    await settle();
    expect(cache.thumbnail(other, 1)).toBe('data:image/jpeg;base64,ok');
  });

  it('记住的张数有上限，最久没用的先丢', async () => {
    const thumbnail = vi.fn(async (_asset: VersionRef, at: number): Promise<MediaThumbnail> => ({
      mimeType: 'image/jpeg',
      data: String(at),
      at,
    }));
    const { cache } = harness({ thumbnail }, { maxThumbnails: 2 });
    cache.thumbnail(clip, 1);
    cache.thumbnail(clip, 2);
    await settle();
    expect(cache.thumbnail(clip, 1)).not.toBeNull();
    cache.thumbnail(clip, 3);
    await settle();
    expect(cache.thumbnail(clip, 1)).not.toBeNull();
    expect(cache.thumbnail(clip, 3)).not.toBeNull();
    expect(cache.thumbnail(clip, 2)).toBeNull();
  });
});
