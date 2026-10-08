import type { Sequence } from '@baocut/protocol';
import { afterEach, expect, test, vi } from 'vitest';
import type { RenderPlanner } from '../../render/render-planner.ts';
import { PreviewEngine, imageKey, type PreviewStatus } from './preview-engine.ts';
import { POLL_MS, STALL_MS } from './preview-watch.ts';

// 引擎跑在浏览器里；这里补上 Node 没有的动画帧函数与 ImageData（装下像素就行）。
vi.stubGlobal('cancelAnimationFrame', () => {});
vi.stubGlobal('ImageData', function (data: Uint8ClampedArray, width: number, height: number) {
  return { data, width, height };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const playable = {
  id: 'seq',
  name: 'main',
  fps: { num: 30, den: 1 },
  canvas: { width: 1920, height: 1080 },
  tracks: [],
  items: [{ id: 'title', type: 'text', enabled: true, trackId: 't', span: { fromFrame: 0, durationFrames: 300 } }],
} as unknown as Sequence;

test('渲染内核一直没载入完：过了门槛打一条开发日志，报告点名卡在载入内核', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => new Promise<RenderPlanner>(() => {}));
  engine.setVideo(playable, {});
  await vi.advanceTimersByTimeAsync(STALL_MS - POLL_MS);
  expect(engine.stallReport).toBeNull();
  await vi.advanceTimersByTimeAsync(2 * POLL_MS);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(engine.stallReport).toMatchObject({ step: 'planner-loading', status: 'loading', video: true, ongoing: true });
  engine.dispose();
  // 停用之后不再看。
  await vi.advanceTimersByTimeAsync(STALL_MS * 3);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('播放的 tick 里抛了意外的错：打出来、接着排下一帧，之后好了照常画', async () => {
  let callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callbacks.push(callback));
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  let broken = false;
  const renders: number[] = [];
  const planAt = (seconds: number) => {
    if (broken) throw new TypeError('boom');
    return {
      sequenceId: 'seq',
      sequenceRevision: 'r1',
      frame: Math.floor(seconds * 30 + 1e-6),
      canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 },
      layers: [{ kind: 'text', itemId: 'title', matrix: [1, 0, 0, 1, 0, 0], opacity: 1, content: {} }],
      voices: [],
    };
  };
  const planner = {
    onRecovered: null,
    setVideo: () => {},
    setSpeech: () => {},
    setDocuments: () => {},
    clearPictures: () => {},
    planAt,
    render: (seconds: number) => {
      renders.push(seconds);
      return { plan: planAt(seconds), warnings: [], skipped: [], spectra: [], fonts: [] };
    },
    frame: () => new Uint8ClampedArray(4),
  } as unknown as RenderPlanner;
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner));
  const canvas = { width: 0, height: 0, getContext: () => ({ canvas, putImageData: () => {} }) };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
  const statuses: PreviewStatus[] = [];
  engine.onStatus((status) => statuses.push(status));
  engine.setVideo(playable, {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  const tick = (ms: number) => {
    now = ms;
    const due = callbacks;
    callbacks = [];
    for (const callback of due) callback(now);
  };

  engine.play();
  broken = true;
  tick(100);
  tick(200);
  expect(engine.playing).toBe(true);
  expect(callbacks).toHaveLength(1);
  // 同一个错一阵只打一次。
  expect(error).toHaveBeenCalledTimes(1);
  // 不改状态（界面照旧）。
  expect(statuses.at(-1)).toEqual({ kind: 'ready' });

  broken = false;
  renders.length = 0;
  tick(300);
  expect(renders).toHaveLength(1);
  engine.pause();
  engine.dispose();
  vi.stubGlobal('requestAnimationFrame', () => 0);
});

/** 只会给出一份计划的计划器（`layers` 是这一刻要画的层）。 */
function stubPlanner(layers: unknown[] = []) {
  const setVideo = vi.fn();
  const planner = {
    onRecovered: null,
    setVideo,
    setSpeech: () => {},
    setDocuments: () => {},
    planAt: () => ({
      sequenceId: 'seq',
      sequenceRevision: 'r1',
      frame: 0,
      canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 },
      layers,
      voices: [],
    }),
  } as unknown as RenderPlanner;
  return { planner, setVideo };
}

test('卡住时通知订阅者；重试不等卡住的那次载入、重新载入，之前那次迟到的结果不收', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const loads: { fresh: boolean; resolve(planner: RenderPlanner): void }[] = [];
  const load = (options?: { fresh?: boolean }) =>
    new Promise<RenderPlanner>((resolve) => loads.push({ fresh: Boolean(options?.fresh), resolve }));
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, load);
  const stalls: (string | null)[] = [];
  engine.onStall((stall) => stalls.push(stall ? stall.step : null));
  engine.setVideo(playable, {});
  await vi.advanceTimersByTimeAsync(STALL_MS + POLL_MS);
  expect(stalls).toEqual([null, 'planner-loading']);
  expect(engine.stall).toMatchObject({ step: 'planner-loading', ongoing: true });

  engine.retry();
  expect(stalls).toEqual([null, 'planner-loading', null]);
  expect(engine.stall).toBeNull();
  expect(loads.map((l) => l.fresh)).toEqual([false, true]);

  const fresh = stubPlanner();
  const late = stubPlanner();
  loads[1]!.resolve(fresh.planner);
  await vi.advanceTimersByTimeAsync(0);
  loads[0]!.resolve(late.planner);
  await vi.advanceTimersByTimeAsync(0);
  expect(fresh.setVideo).toHaveBeenCalled();
  expect(late.setVideo).not.toHaveBeenCalled();
  // 内核好了，不再卡在载入内核（这里没给画布，之后卡在「还没有画布」）。
  await vi.advanceTimersByTimeAsync(STALL_MS * 2);
  expect(engine.stall?.step).toBe('no-canvas');
  engine.dispose();
});

test('素材地址一直没到（页面上没有元素）：画面是空的、状态照常，满门槛报在等这个素材', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // Node 里没有这几个元素类：引擎只拿它们做 instanceof。
  vi.stubGlobal('HTMLVideoElement', class {});
  vi.stubGlobal('HTMLImageElement', class {});
  const { planner } = stubPlanner([
    { kind: 'video', itemId: 'clip', asset: { id: 'asset_a', revision: '1' }, sourceSeconds: 0, matrix: [1, 0, 0, 1, 0, 0], opacity: 1 },
  ]);
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner));
  const statuses: PreviewStatus[] = [];
  engine.onStatus((status) => statuses.push(status));
  engine.setVideo(playable, {});
  await vi.advanceTimersByTimeAsync(STALL_MS + POLL_MS);
  expect(statuses.at(-1)).toEqual({ kind: 'ready' });
  expect(engine.stall).toMatchObject({ step: 'media-pending', media: [{ itemId: 'clip', assetId: 'asset_a', wait: 'no-element' }] });
  engine.dispose();
  vi.unstubAllGlobals();
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ImageData', function (data: Uint8ClampedArray, width: number, height: number) {
    return { data, width, height };
  });
});

test('媒体在等兼容副本：画面不算出来过；进度不动满门槛报卡在转换，不知道进度不报；媒体齐了才算出来，重试与换视频从头算', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('HTMLVideoElement', class {});
  vi.stubGlobal('HTMLImageElement', class {});
  vi.stubGlobal('HTMLMediaElement', class {});
  const clip = { kind: 'video', itemId: 'clip', asset: { id: 'asset_a', revision: '1' }, sourceSeconds: 0, matrix: [1, 0, 0, 1, 0, 0], opacity: 1 };
  let layers: unknown[] = [clip];
  const plan = () => ({
    sequenceId: 'seq',
    sequenceRevision: 'r1',
    frame: 0,
    canvas: { width: 1920, height: 1080, background: '#000000', backgroundAlpha: 1 },
    layers,
    voices: [],
  });
  const planner = {
    onRecovered: null,
    setVideo: () => {},
    setSpeech: () => {},
    setDocuments: () => {},
    clearPictures: () => {},
    planAt: plan,
    render: () => ({ plan: plan(), warnings: [], skipped: [], spectra: [], fonts: [] }),
    frame: () => new Uint8ClampedArray(4),
  } as unknown as RenderPlanner;
  let progress: number | null | undefined = null;
  const engine = new PreviewEngine({ onTime: () => {}, onEnded: () => {} }, () => Promise.resolve(planner), null, null, null, (asset) =>
    asset.id === 'asset_a' ? progress : undefined,
  );
  const putImageData = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ canvas, putImageData }) };
  engine.attachCanvas(canvas as unknown as HTMLCanvasElement, 0.5);
  const pictures: boolean[] = [];
  engine.onPicture((pictured) => pictures.push(pictured));
  engine.setVideo(playable, {});

  // 还不知道进度：画了黑帧，但画面不算出来过，也不算卡住。
  await vi.advanceTimersByTimeAsync(STALL_MS * 2);
  expect(putImageData).toHaveBeenCalled();
  expect(engine.pictured).toBe(false);
  expect(engine.stall).toBeNull();

  progress = 0.4;
  await vi.advanceTimersByTimeAsync(STALL_MS + 2 * POLL_MS);
  expect(engine.stall).toMatchObject({ step: 'media-preparing', media: [{ assetId: 'asset_a', wait: 'preparing', progress: 0.4 }] });

  // 转好了、这一刻没有要等的媒体：画面出来了。
  progress = undefined;
  layers = [];
  engine.setVideo(playable, {});
  await vi.advanceTimersByTimeAsync(0);
  expect(engine.pictured).toBe(true);

  engine.retry();
  expect(engine.pictured).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(engine.pictured).toBe(true);
  // 同一部视频换一版不从头算；换一部视频从头算。
  engine.setVideo(playable, {});
  expect(engine.pictured).toBe(true);
  engine.setVideo({ ...playable, id: 'seq_other' } as Sequence, {});
  expect(engine.pictured).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(pictures).toEqual([false, true, false, true, false, true]);
  // 载入失败的图片不再等：这一帧照画、跳过它，画面算出来了（缺的由卡住诊断与问题提示说）。
  const broken = { kind: 'image', itemId: 'logo', asset: { id: 'asset_img', revision: '1' }, matrix: [1, 0, 0, 1, 0, 0], opacity: 1 };
  layers = [broken];
  engine.retry();
  await vi.advanceTimersByTimeAsync(0);
  expect(engine.pictured).toBe(false);
  const image = Object.assign(new (globalThis.HTMLImageElement as unknown as new () => object)(), {
    complete: true,
    naturalWidth: 0,
    src: 'x',
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  engine.register(imageKey(broken.asset), image as unknown as HTMLImageElement);
  await vi.advanceTimersByTimeAsync(0);
  expect(engine.pictured).toBe(true);
  engine.dispose();
  vi.unstubAllGlobals();
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ImageData', function (data: Uint8ClampedArray, width: number, height: number) {
    return { data, width, height };
  });
});
