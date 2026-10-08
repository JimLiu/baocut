import type { Id } from '@baocut/protocol';

/**
 * 预览卡住时的诊断：引擎每隔一会儿交一份快照，卡在同一步超过 `STALL_MS` 就打一条 `console.warn`，点名卡在哪一步
 * （开发时 Electron 主进程把它转到终端），同时通知订阅者（舞台上的卡住提示，产品设计 §5.1「预览载入与卡住」）。
 * 同一段卡住只报一次，有了进展（这一步过去了、换了一步）再重新计时。在等 Runtime 准备兼容副本的媒体：进度在走就算有进展，
 * Runtime 还不知道进度时不算卡住（转换有自己的超时，失败走主媒体放不出来那张卡）。
 *
 * 用计时器轮询，不用 requestAnimationFrame：窗口被挡住或隐藏时 rAF 不跑。页面隐藏期间不计时（隐藏时不画是正常的）。
 */

/** 卡住的是哪一步。 */
export type StallStep =
  /** 渲染内核（WASM 与随它发布的字体）还没载入完。 */
  | 'planner-loading'
  /** 内核好了，还没交给它视频。 */
  | 'no-video'
  /** 视频交给内核时出错了，还没对上元素。 */
  | 'video-error'
  /** 内核与视频都有了，还没求出一份计划（多半是求计划时抛了意外的错，见 `lastError`）。 */
  | 'no-plan'
  /** 这一刻要画的媒体层或要出声的元素一直没好（没有元素、载入不了、定位不落地），见 `media`。 */
  | 'media-pending'
  /** 要的媒体都在等兼容副本，转换的进度一直没动，见 `media`。 */
  | 'media-preparing'
  /** 字幕层要的文档正文一直没取到，见 `documents`。 */
  | 'documents-pending'
  /** 本机字体一直没取完，见 `fonts`。 */
  | 'fonts-loading'
  /** 有一帧要画，画布上一直没换（画的时候抛了意外的错，见 `lastError`）。 */
  | 'not-painted'
  /** 有一帧要画，但还没有画布。 */
  | 'no-canvas';

/** 媒体为什么还没好。 */
export type MediaWait =
  /** 页面上没有这个元素（多半是素材地址还没取到：比如 Runtime 没连上）。 */
  | 'no-element'
  /** 还没有元素：Runtime 在准备兼容副本（浏览器放不了这个 WebM），见 `progress`。 */
  | 'preparing'
  /** 元素载入或解码出错。 */
  | 'error'
  /** 还没有这一刻的画面（`readyState` 不到 HAVE_CURRENT_DATA）。 */
  | 'no-data'
  /** 定位还没落地。 */
  | 'seeking'
  /** 有画面，但不在要的那一刻。 */
  | 'position'
  /** 在内核里解的图片（SVG、GIF）：字节还在取，或取不到。 */
  | 'bytes-loading'
  | 'bytes-missing';

/** 一个还没好的媒体层或声音。不记地址：地址里可能带着访问凭据。 */
export interface MediaProbe {
  itemId: Id;
  /** 取画面或声音的素材（界面按它点名「在等哪个媒体」）。 */
  assetId?: Id;
  kind: 'video' | 'image' | 'audio';
  wait: MediaWait;
  /** 要的源时刻（秒）；图片没有。 */
  wantedSeconds: number | null;
  /** `preparing` 时兼容副本编码到了几成（0–1），Runtime 还不知道时 null。 */
  progress?: number | null;
  /** 元素的状态；没有元素或不经元素（内核解的图片）时为 null。 */
  element: {
    readyState: number | null;
    networkState: number | null;
    errorCode: number | null;
    seeking: boolean;
    currentTime: number | null;
    hasSource: boolean;
  } | null;
}

/** 引擎交来的快照。 */
export interface PreviewSnapshot {
  status: 'loading' | 'ready' | 'error';
  planner: 'loading' | 'ready';
  video: boolean;
  videoError: string | null;
  plan: boolean;
  canvas: boolean;
  playing: boolean;
  /** 画布上最近画的那一帧：每画一帧换一个对象，按身份比较有没有进展。 */
  painted: object | null;
  /** 有一帧要画（播放中、重画排着、有东西变了、计划还没画上去）。 */
  paintWanted: boolean;
  media: MediaProbe[];
  documents: Id[];
  fonts: string[];
}

export interface StallReport extends Omit<PreviewSnapshot, 'painted'> {
  step: StallStep;
  /** 卡在这一步多久了（毫秒，只算页面可见的时间）。 */
  stalledMs: number;
  /** 从什么时候开始卡在这一步（诊断的时钟，默认 `performance.now()`）；界面按它逐秒数「已经等了多久」。 */
  since: number;
  /** 最近一次被兜住的意外错误（播放的 tick、重画、媒体事件里抛的）。 */
  lastError: string | null;
  /** 还卡着；之后有了进展会改成 false。 */
  ongoing: boolean;
}

/** 卡在同一步这么久才报。 */
export const STALL_MS = 10_000;
/** 多久看一次。 */
export const POLL_MS = 2_000;
/** 同一个意外错误这么久内只打一次（播放中每帧都抛时不刷屏）。 */
const ERROR_REPEAT_MS = 10_000;

export interface WatchOptions {
  now?: () => number;
  /** 排一次检查，返回取消的函数。 */
  schedule?: (run: () => void, ms: number) => () => void;
  visible?: () => boolean;
  warn?: (message: string, report: StallReport) => void;
  error?: (message: string, error: unknown) => void;
}

// i18n-ignore-start: 开发日志
const STEP_LABELS: Record<StallStep, string> = {
  'planner-loading': '渲染内核还没载入完',
  'no-video': '渲染内核好了，还没交给它视频',
  'video-error': '视频交给渲染内核时出错',
  'no-plan': '还没求出帧计划',
  'media-pending': '在等媒体',
  'media-preparing': '在等兼容副本，转换没有进展',
  'documents-pending': '在等字幕文档',
  'fonts-loading': '在等本机字体',
  'not-painted': '有一帧要画，画布上一直没换',
  'no-canvas': '有一帧要画，还没有画布',
};
// i18n-ignore-end

/** 这份快照卡在哪一步；`progressed` 是上次看过之后画布上换过帧。没卡住是 null。 */
export function stalledStep(snapshot: PreviewSnapshot, progressed: boolean): StallStep | null {
  // 出错时界面有提示，不算卡住。
  if (snapshot.status === 'error') return null;
  if (snapshot.status === 'loading') {
    if (snapshot.planner === 'loading') return 'planner-loading';
    if (!snapshot.video) return 'no-video';
    if (snapshot.videoError) return 'video-error';
    return 'no-plan';
  }
  if (snapshot.media.length > 0) {
    if (snapshot.media.some((probe) => probe.wait !== 'preparing')) return 'media-pending';
    // 都在等兼容副本：不知道进度的不算卡住；进度动没动由 `PreviewWatch` 比对（见 `preparingMark`）。
    return snapshot.media.some((probe) => probe.progress == null) ? null : 'media-preparing';
  }
  if (snapshot.documents.length > 0) return 'documents-pending';
  if (snapshot.fonts.length > 0) return 'fonts-loading';
  if (snapshot.paintWanted && !progressed) return snapshot.canvas ? 'not-painted' : 'no-canvas';
  return null;
}

/** 转换的进度记号：按原始的 0–1 比，不按取整的百分比（长片的 1% 可能比卡住门槛还久）。 */
export function preparingMark(snapshot: Pick<PreviewSnapshot, 'media'>): string {
  return snapshot.media
    .filter((probe) => probe.wait === 'preparing')
    .map((probe) => `${probe.assetId ?? probe.itemId}=${probe.progress ?? ''}`)
    .sort()
    .join(',');
}

/** 元素现在为什么还不能用（`readyState` 等按 HTMLMediaElement 的常量，2 是 HAVE_CURRENT_DATA）。 */
export function probeElement(element: Partial<HTMLMediaElement & HTMLImageElement> | null | undefined): {
  wait: MediaWait;
  element: MediaProbe['element'];
} {
  if (!element) return { wait: 'no-element', element: null };
  const isImage = typeof element.complete === 'boolean' && element.readyState === undefined;
  const state = {
    readyState: element.readyState ?? null,
    networkState: element.networkState ?? null,
    errorCode: element.error?.code ?? null,
    seeking: element.seeking ?? false,
    currentTime: element.currentTime ?? null,
    hasSource: Boolean(element.currentSrc || element.src),
  };
  if (isImage) return { wait: element.complete && !(element.naturalWidth! > 0) ? 'error' : 'no-data', element: state };
  if (element.error) return { wait: 'error', element: state };
  if (element.seeking) return { wait: 'seeking', element: state };
  if ((element.readyState ?? 0) < 2) return { wait: 'no-data', element: state };
  return { wait: 'position', element: state };
}

export class PreviewWatch {
  readonly #probe: () => PreviewSnapshot;
  readonly #now: () => number;
  readonly #schedule: (run: () => void, ms: number) => () => void;
  readonly #visible: () => boolean;
  readonly #warn: (message: string, report: StallReport) => void;
  readonly #error: (message: string, error: unknown) => void;
  #running = false;
  #cancel: (() => void) | null = null;
  #step: StallStep | null = null;
  /** 卡在转换时的进度记号：变了就算有进展。 */
  #mark = '';
  #since = 0;
  #warned = false;
  #lastPainted: object | null = null;
  #report: StallReport | null = null;
  #lastError: { message: string; at: number } | null = null;
  readonly #listeners = new Set<(report: StallReport | null) => void>();

  constructor(probe: () => PreviewSnapshot, options: WatchOptions = {}) {
    this.#probe = probe;
    this.#now = options.now ?? (() => performance.now());
    // 建的时候就取下计时器：测试里换成假计时器之前建的引擎，停的时候也用同一套。
    const { setTimeout: set, clearTimeout: clear } = globalThis;
    this.#schedule =
      options.schedule ??
      ((run, ms) => {
        const timer = set(run, ms);
        return () => clear(timer);
      });
    this.#visible = options.visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
    this.#warn = options.warn ?? ((message, report) => console.warn(message, report)); // i18n-ignore: 开发日志
    this.#error = options.error ?? ((message, error) => console.error(message, error)); // i18n-ignore: 开发日志
  }

  /** 最近一次报出的卡住（之后有了进展 `ongoing` 改成 false）；没报过是 null。 */
  get report(): StallReport | null {
    return this.#report;
  }

  /** 还卡着的那一段（`report` 里 `ongoing` 为真的那份）；没卡住是 null。 */
  get ongoing(): StallReport | null {
    return this.#report?.ongoing ? this.#report : null;
  }

  /** 报出卡住、卡住结束时通知（参数是还卡着的那一段，结束了是 null）；返回取消订阅的函数。 */
  onChange(listener: (report: StallReport | null) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 从头计时（重试之后）：手上的卡住算结束，之后还卡着要再满 `STALL_MS` 才报。 */
  reset(): void {
    this.#reset();
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#reset();
    this.#arm();
  }

  stop(): void {
    this.#running = false;
    this.#cancel?.();
    this.#cancel = null;
  }

  /** 看一次（计时器到点时调用；测试直接调）。 */
  check(): void {
    if (!this.#visible()) {
      // 隐藏时不画是正常的：回来之后重新计时。
      this.#reset();
      return;
    }
    const snapshot = this.#probe();
    const progressed = snapshot.painted !== this.#lastPainted;
    this.#lastPainted = snapshot.painted;
    const step = stalledStep(snapshot, progressed);
    const mark = step === 'media-preparing' ? preparingMark(snapshot) : '';
    const now = this.#now();
    if (step !== this.#step || mark !== this.#mark) {
      this.#end();
      this.#step = step;
      this.#mark = mark;
      this.#since = now;
      this.#warned = false;
    }
    if (!step || this.#warned || now - this.#since < STALL_MS) return;
    this.#warned = true;
    const { painted: _painted, ...rest } = snapshot;
    const report: StallReport = {
      ...rest,
      step,
      stalledMs: Math.round(now - this.#since),
      since: this.#since,
      lastError: this.#lastError?.message ?? null,
      ongoing: true,
    };
    this.#report = report;
    // i18n-ignore: 开发日志
    this.#warn(`[preview] 预览卡住了：${STEP_LABELS[step]}（${Math.round((now - this.#since) / 1000)} 秒）`, report);
    this.#notify(report);
  }

  /** 播放的 tick、重画、媒体事件里抛了意外的错：兜住、打出来（同一个错一阵只打一次），记进下一份报告。 */
  noteError(where: string, error: unknown): void {
    const message = `${where}: ${error instanceof Error ? error.message : String(error)}`;
    const now = this.#now();
    const last = this.#lastError;
    this.#lastError = { message, at: last?.message === message && now - last.at < ERROR_REPEAT_MS ? last.at : now };
    if (last?.message === message && now - last.at < ERROR_REPEAT_MS) return;
    // i18n-ignore: 开发日志
    this.#error(`[preview] ${where}时抛了意外的错，预览接着跑`, error);
  }

  #reset(): void {
    this.#step = null;
    this.#mark = '';
    this.#warned = false;
    this.#end();
  }

  /** 手上还卡着的那一段算结束。 */
  #end(): void {
    if (!this.#report?.ongoing) return;
    this.#report = { ...this.#report, ongoing: false };
    this.#notify(null);
  }

  #notify(report: StallReport | null): void {
    for (const listener of this.#listeners) {
      try {
        listener(report);
      } catch (error) {
        this.noteError('卡住通知', error); // i18n-ignore: 开发日志
      }
    }
  }

  #arm(): void {
    this.#cancel = this.#schedule(() => {
      if (!this.#running) return;
      try {
        this.check();
      } catch (error) {
        // 诊断自己出错不该影响预览。
        this.noteError('卡住诊断', error); // i18n-ignore: 开发日志
      }
      if (this.#running) this.#arm();
    }, POLL_MS);
  }
}
