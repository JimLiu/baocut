import { previewEngineOf, useShell, type PlaybackStats, type StallReport } from '@baocut/ui/diagnostics';

/** 一次播放基准的参数：打开哪个视频（项目里的相对路径）、从哪一刻开始、放多久。 */
export interface PreviewBenchInput {
  projectId: string;
  path: string;
  /** 从这一刻开始放（秒）。 */
  at: number;
  /** 放多久（秒）。 */
  seconds: number;
  /** 打开视频、等预览就绪的时限（毫秒）。 */
  openTimeoutMs: number;
}

export interface PreviewBenchResult {
  /** 序列画布与画帧用的像素尺寸。 */
  canvas: { width: number; height: number };
  size: { width: number; height: number } | null;
  devicePixelRatio: number;
  visibility: DocumentVisibilityState;
  /** 打开视频到预览就绪。 */
  openMs: number;
  /** 打开视频到画上精确的第一帧（媒体都到了）。 */
  openExactMs: number | null;
  /** 按下播放到第一帧画上去。 */
  firstFrameMs: number | null;
  /** 播放了多久（毫秒）与其间画上去的帧。 */
  elapsedMs: number;
  presented: number;
  /** 画上去的不同的视频帧、这段时间里视频走过的帧、没画出来的帧。 */
  distinctFrames: number;
  spannedFrames: number;
  droppedFrames: number;
  presentedFps: number;
  /** 视频自己的帧率（按走过的帧与时间算）。 */
  sourceFps: number;
  stats: Omit<PlaybackStats, 'tickMs' | 'uploadMs' | 'renderMs' | 'drift' | 'frames'>;
  tickMs: Quantiles;
  uploadMs: Quantiles;
  renderMs: Quantiles;
  /** requestAnimationFrame 的间隔（页面的刷新节奏，主线程被占住时变长）。 */
  rafIntervalMs: Quantiles;
  /** 超过 50 ms 的长任务：个数与最长的一个（播放的第一秒另记）。 */
  longTasks: { count: number; maxMs: number; firstSecond: number };
  /** 媒体元素与计划的偏差（毫秒）。 */
  driftMs: Quantiles;
  /** 媒体元素报 `waiting`（等数据、声音停住）的次数。 */
  waiting: number;
  /** 停着时拖动播放头：每次定位到新画面画上去的毫秒。 */
  scrubMs: Quantiles;
  /** 每一下拖动的毫秒（按先后，画不上去的记 `null`）。 */
  scrubSteps: (number | null)[];
  /** 拖动的最后一下到画上精确的那一帧（与导出同一帧）的毫秒。 */
  scrubSettleMs: number | null;
  /** 停着跳到远处一刻（点时间线）：到第一次画上去、到画上精确的那一帧的毫秒。 */
  jumpMs: { first: number | null; exact: number | null };
  /** 预览最近一次卡住的诊断（引擎的 `stallReport`）；没卡过是 null。 */
  stall: StallReport | null;
}

interface Quantiles {
  p50: number;
  p95: number;
  max: number;
}

declare global {
  var baocutPreviewBench: ((input: PreviewBenchInput) => Promise<PreviewBenchResult>) | undefined;
}

function quantiles(values: number[]): Quantiles {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0);
  const round = (value: number) => Math.round(value * 100) / 100;
  return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1) ?? 0) };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(probe: () => T | null | undefined, timeoutMs: number, what: string): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    // i18n-ignore: 开发用基准的诊断输出，不进界面
    if (performance.now() > deadline) throw new Error(`等 ${what} 超过 ${timeoutMs} ms`);
    await delay(20);
  }
}

/** 下一次往预览画布上画（`putImageData` 或 `drawImage`）的时刻。 */
function nextPresent(canvas: HTMLCanvasElement): Promise<number> {
  return new Promise((resolve) => {
    const context = canvas.getContext('2d')!;
    const methods = ['putImageData', 'drawImage'] as const;
    const originals = methods.map((name) => context[name]);
    methods.forEach((name, index) => {
      (context as any)[name] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        methods.forEach((method, i) => ((context as any)[method] = originals[i]));
        const result = (originals[index] as any).apply(this, args);
        resolve(performance.now());
        return result;
      };
    });
  });
}

/** 下一次画上精确的那一帧（`engine.exact`）的时刻；超时给 `null`。 */
async function nextExact(canvas: HTMLCanvasElement, engine: { readonly exact: boolean }, timeoutMs: number): Promise<number | null> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const left = deadline - performance.now();
    if (left <= 0) return null;
    const painted = await Promise.race([nextPresent(canvas), delay(left).then(() => null)]);
    if (painted === null) return null;
    if (engine.exact) return painted;
  }
}

// 按结构而不是界面文字找元素：界面的 aria-label 随界面语言变。
const PREVIEW_CANVAS = 'canvas[data-preview-status]';
const PREVIEW_READY = 'canvas[data-preview-status="ready"]';
const PLAY_BUTTON = 'button.bc-transport-play';

/**
 * 预览播放的端到端基准（`npm run bench:preview`，`tools/preview-bench.mjs`）：随产物构建、应用自己不加载。
 * 基准脚本在隐藏窗口里打开真正的界面、连上隔离的 Runtime 之后动态导入这一份，调 `baocutPreviewBench()`：经外壳打开视频，
 * 停着时拖几下播放头，再按「播放」放一段，按引擎的计数与页面的长任务、刷新间隔、媒体元素的 `waiting` 汇总。
 */
globalThis.baocutPreviewBench = async (input) => {
  // 先离开编辑器、等上一个视频的预览画布拆掉，免得把它当成这一个的。
  useShell.getState().navigate('/space');
  // i18n-ignore: 开发用基准的诊断输出（等待项的名字），不进界面
  await waitFor(() => !document.querySelector(PREVIEW_CANVAS), input.openTimeoutMs, '上一个预览关掉');
  const opened = performance.now();
  useShell.getState().openVideo({ projectId: input.projectId, path: input.path });
  const canvas = await waitFor(
    () => document.querySelector<HTMLCanvasElement>(PREVIEW_READY),
    input.openTimeoutMs,
    // i18n-ignore: 开发用基准的诊断输出（等待项的名字），不进界面
    '预览就绪',
  ).catch((error: unknown) => {
    // 等不到就绪：带上引擎的卡住诊断（卡在哪一步）。
    const stuck = document.querySelector<HTMLCanvasElement>(PREVIEW_CANVAS);
    const report = stuck ? previewEngineOf(stuck)?.stallReport : undefined;
    throw report ? new Error(`${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(report)}`) : error;
  });
  // i18n-ignore: 开发用基准的诊断输出（等待项的名字），不进界面
  const engine = await waitFor(() => previewEngineOf(canvas), input.openTimeoutMs, '预览引擎');
  // i18n-ignore: 同上
  await waitFor(() => engine.plan, input.openTimeoutMs, '帧计划');
  const openMs = performance.now() - opened;
  // 等第一帧画好（媒体都到了）再拖，否则量到的是载入。
  const openExact = engine.exact ? performance.now() : await nextExact(canvas, engine, input.openTimeoutMs);
  const openExactMs = openExact === null ? null : Math.round(openExact - opened);

  // 停着时拖动播放头：画上去之后隔 50 ms 再定位一次，记到画上去的时间；最后一下之后记到画上精确那一帧的时间。
  const scrub: (number | null)[] = [];
  let scrubSettleMs: number | null = null;
  for (let i = 0; i < 8; i++) {
    const painted = nextPresent(canvas);
    const start = performance.now();
    engine.seek(input.at + i * 0.4);
    const end = await Promise.race([painted, delay(2000).then(() => null)]);
    scrub.push(end === null ? null : Math.round(end - start));
    if (i < 7) await delay(50);
    else {
      const exact = await nextExact(canvas, engine, 3000);
      scrubSettleMs = exact === null ? null : Math.round(exact - start);
    }
  }
  // 停下之后跳到几秒外（点时间线，多半落在关键帧之间），再回到开头准备播放。
  await delay(300);
  const jumpFirst = nextPresent(canvas);
  const jumped = performance.now();
  engine.seek(input.at + 5.3);
  const jumpPainted = await Promise.race([jumpFirst, delay(3000).then(() => null)]);
  const jumpExact = engine.exact ? jumpPainted : await nextExact(canvas, engine, 3000);
  const jumpMs = {
    first: jumpPainted === null ? null : Math.round(jumpPainted - jumped),
    exact: jumpExact === null ? null : Math.round(jumpExact - jumped),
  };
  engine.seek(input.at);
  await nextExact(canvas, engine, 3000);
  await delay(1000);

  const longTasks: { start: number; duration: number }[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
  });
  observer.observe({ type: 'longtask', buffered: false });
  let waiting = 0;
  const onWaiting = () => waiting++;
  const media = [...document.querySelectorAll<HTMLMediaElement>('video, audio')];
  for (const element of media) element.addEventListener('waiting', onWaiting);
  const intervals: number[] = [];
  let last = 0;
  let measuring = true;
  const frame = (now: number) => {
    if (last) intervals.push(now - last);
    last = now;
    if (measuring) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // i18n-ignore: 开发用基准的诊断输出（等待项的名字），不进界面
  const play = await waitFor(() => document.querySelector<HTMLButtonElement>(PLAY_BUTTON), 5000, '播放按钮');
  const firstPresent = nextPresent(canvas);
  const started = performance.now();
  play.click();
  const first = await Promise.race([firstPresent, delay(input.seconds * 1000).then(() => null)]);
  await delay(Math.max(0, input.seconds * 1000 - (performance.now() - started)));
  const stats = structuredClone(engine.stats);
  const elapsedMs = performance.now() - started;
  // 播放中同一个键就是「暂停」。
  document.querySelector<HTMLButtonElement>(PLAY_BUTTON)?.click();
  measuring = false;
  observer.disconnect();
  for (const element of media) element.removeEventListener('waiting', onWaiting);

  const plan = engine.plan!;
  const frames = stats.frames;
  const distinct = new Set(frames).size;
  const spanned = frames.length ? Math.max(...frames) - Math.min(...frames) + 1 : 0;
  const { tickMs, uploadMs, renderMs, drift, frames: _frames, ...counts } = stats;
  return {
    canvas: { width: plan.canvas.width, height: plan.canvas.height },
    size: stats.size,
    devicePixelRatio: window.devicePixelRatio,
    visibility: document.visibilityState,
    openMs: Math.round(openMs),
    openExactMs,
    firstFrameMs: first === null ? null : Math.round(first - started),
    elapsedMs: Math.round(elapsedMs),
    presented: stats.presented,
    distinctFrames: distinct,
    spannedFrames: spanned,
    droppedFrames: Math.max(0, spanned - distinct),
    presentedFps: Math.round((stats.presented / elapsedMs) * 1000 * 10) / 10,
    sourceFps: Math.round((spanned / elapsedMs) * 1000 * 10) / 10,
    stats: counts,
    tickMs: quantiles(tickMs),
    uploadMs: quantiles(uploadMs),
    renderMs: quantiles(renderMs),
    rafIntervalMs: quantiles(intervals),
    longTasks: {
      count: longTasks.length,
      maxMs: Math.round(Math.max(0, ...longTasks.map((task) => task.duration))),
      firstSecond: longTasks.filter((task) => task.start < started + 1000).length,
    },
    driftMs: quantiles(drift.map((seconds) => seconds * 1000)),
    waiting,
    scrubMs: quantiles(scrub.filter((ms) => ms !== null)),
    scrubSteps: scrub,
    scrubSettleMs,
    jumpMs,
    stall: engine.stallReport,
  };
};
