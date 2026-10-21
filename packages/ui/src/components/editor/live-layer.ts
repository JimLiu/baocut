import {
  isCompositionBridgeMessage,
  COMPOSITION_BRIDGE_CHANNEL,
  type BundleHandle,
  type CodeBundleContract,
  type CompositionBridgeCapture,
  type CompositionBridgeMessage,
  type CompositionBridgePick,
  type CompositionBridgeRequest,
  type CompositionBridgeResponse,
  type Id,
  type VersionRef,
} from '@baocut/protocol';
import type { LiveCandidate } from '../../model/live-composition.ts';
import type { Rect } from '../../model/stage-pose.ts';
import type { LiveLayer } from '../../render/frame-plan.ts';

/**
 * 实时合成层的宿主（动效视频设计 §4.1–§4.3）：舞台画布底下的沙箱 `<iframe>`，每个要实时播的代码包合成一个。
 *
 * - iframe 带 `sandbox="allow-scripts"`（不开 `allow-same-origin`，来源不透明；媒体通道的响应头还带同样的 `sandbox`），
 *   句柄在只给代码包的专用来源上（`isolation: 'origin'`，Web 服务的代码包端口）且与页面不同源时再开 `allow-same-origin`：
 *   页面用那个来源，有的宿主内置浏览器会拦不透明来源的沙箱 iframe（架构设计 §4.5「代码包来源」）。iframe 拿到地址、定好 sandbox
 *   才挂进页面（那种浏览器按挂上那一刻的 sandbox 判断）。
 *   `inert`、`pointer-events: none`：指针与键盘都进不了包，舞台点选照旧按实例的几何盒算。
 * - 页面经 `media.bundle` 的目录句柄载入（每次挂上都重新要一个，句柄有期限）；入口页面里注好了取帧脚本与桥，
 *   页面发 `hello` 之后宿主发 `ready`，就位后先定位到第 0 帧（预载的意思就是这一步做完）。
 * - `seek` 一次只发一个在路上的：播放中一个视频帧只送一次，没回来之前又来了新的就只记最新的，回来再发。
 *   页面里的取帧脚本等两次 `requestAnimationFrame` 才回信，回信到了就是「到了」。
 * - 计时分两段（动效视频设计 §4.3）：要地址与载入页面到 `hello` 是 `loadTimeoutMs`（要地址、设好地址各起一次），
 *   发出 `ready` 到回信是 `readyTimeoutMs`。`hello` 由注在 `<head>` 开头的桥发，早于包自己的脚本与字体，所以载入字体、
 *   图片与 `initialize` 都落在第二段；第二段与离屏宿主的就绪等待同样长，页面里的注册轮询也用它（宿主多等一点，让页面先报）。
 * - 载入失败、`ready` 或 `seek` 报错、任一段超时：报给引擎，由引擎把这件拉黑、退回替身或占位。
 * - 在视的那个还没画出第一帧（页面在载入、还没就位，或第一次定位还没回信）时报「在载入」，舞台照常盖着载入面板。
 * - 在视的那个按帧计划的 `matrix` 摆（按清单固有尺寸布置页面再 CSS 变换），其余预载的留在版面里但不显示
 *   （`opacity: 0`，不用 `display: none`，否则页面的动画帧不跑）。最多挂 `maxMounted` 个。
 * - 「选择元素」的拾取（`pick`，lite-editor §4.1、§11 第 12 条）：画布上的点按 `matrix` 反推成固有像素问在视的那个，回来的节点框
 *   再正变换回画布像素；高亮由标记层按这个框画，不进页面。与 `seek` 各占一个在路上的名额，同样只记最新；超时或报错兑现 `null`，
 *   不算失败（不拉黑）。`inert` 与 `pointer-events: none` 不挡页面里的 `elementFromPoint`。
 * - Web 截图模式的取图（`capture`，lite-editor §4.1、§11 第 14 条）：iframe 与页面不同源，父页面拷不到它的像素，改问在视的那个要
 *   此刻这一帧的 PNG（页面自己画，画不全时回 `null`）；连同这一帧的摆法（`matrix`、`opacity`）交给截图去叠预览画布。同一时刻只有一个
 *   在路上，再要就等同一个；超时、报错、拆掉都兑现 `null`，不算失败。
 */

export interface LiveHost {
  /** 该挂着的合成（在视的排第一）：挂上没有的、拆掉不在列表里的。 */
  prepare(candidates: readonly LiveCandidate[]): void;
  /** 这一帧的实时层（没有时 null）：摆位、送这一帧的本地时刻。`frame` 是视频帧号，同一帧不重送。 */
  show(layer: LiveLayer | null, frame: number): void;
  onFailure(listener: (itemId: Id, reason: string) => void): () => void;
  /** 在视的那个还没画出第一帧（`true`）或已画出、没有在视的、失败了（`false`）；变了时通知，订阅时先给一次当前的。 */
  onLoading(listener: (loading: boolean) => void): () => void;
}

export type ResolveBundle = (asset: VersionRef) => Promise<BundleHandle>;

/** iframe 与页面之间的信道：默认是 `contentWindow.postMessage` 与窗口的 `message` 事件；测试换成假的。 */
export interface BridgePort {
  post(request: CompositionBridgeRequest): void;
  /** 只交来自这个 iframe 的桥消息；返回取消订阅的函数。 */
  subscribe(listener: (message: CompositionBridgeMessage) => void): () => void;
}

export interface LiveLayerHostOptions {
  /** 要地址、载入页面到 `hello` 各等多久（默认 3 s）。 */
  loadTimeoutMs?: number;
  /** 发出 `ready` 到回信等多久（默认 20 s）：注册、字体、`initialize` 都在这段里。 */
  readyTimeoutMs?: number;
  /** 拾取等多久（默认 400 ms）；过了兑现 null。 */
  pickTimeoutMs?: number;
  /** 取图等多久（默认 2.5 s，留出剪贴板要的用户手势时限）；过了兑现 null。 */
  captureTimeoutMs?: number;
  maxMounted?: number;
  port?: (element: HTMLIFrameElement) => BridgePort;
}

function windowPort(element: HTMLIFrameElement): BridgePort {
  const view = element.ownerDocument.defaultView;
  return {
    post: (request) => element.contentWindow?.postMessage(request, '*'),
    subscribe: (listener) => {
      const onMessage = (event: MessageEvent) => {
        const page = element.contentWindow;
        if (!page || event.source !== page || !isCompositionBridgeMessage(event.data)) return;
        listener(event.data);
      };
      view?.addEventListener('message', onMessage);
      return () => view?.removeEventListener('message', onMessage);
    },
  };
}

/** 句柄在代码包专用来源上、且与嵌它的页面不同源：只有这时开 `allow-same-origin` 不会让包拿到页面的权限。 */
function ownOrigin(handle: BundleHandle, element: HTMLIFrameElement): boolean {
  if (handle.isolation !== 'origin') return false;
  const page = element.ownerDocument.location;
  try {
    const origin = new URL(handle.url, page.href).origin;
    return origin !== 'null' && origin !== page.origin;
  } catch {
    return false;
  }
}

const LOAD_TIMEOUT_MS = 3000;
/** 与离屏宿主的就绪等待（`composition-host.ts` 的 `DEFAULT_OPEN_TIMEOUT_MS`）同样长：冷载入两份 8 MB 的中文字体就要两三秒。 */
const READY_TIMEOUT_MS = 20_000;
/** 宿主比页面里的注册轮询多等这么久，让页面的 `COMPOSITION_TIMELINE_MISSING` 先到。 */
const READY_GRACE_MS = 1000;
const MAX_MOUNTED = 3;
const PICK_TIMEOUT_MS = 400;
const CAPTURE_TIMEOUT_MS = 2500;
/** 页面回的图：边长与字节的上限（与页面里的 `SIDE_MAX` 同）。 */
const CAPTURE_SIDE_MAX = 8192;
const CAPTURE_BYTES_MAX = 256 * 1024 * 1024;

type Matrix = LiveLayer['matrix'];

/** 拾到的节点：框在画布像素（外包盒），`node` 是页面回的说明（验过形）。 */
export interface LivePick {
  itemId: Id;
  rect: Rect;
  node: CompositionBridgePick;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optionalString = (v: unknown) => v === undefined || typeof v === 'string';

/** 页面回的 `pick` 结果（不受信）逐字段验形：不合就当 `null`；只留协议认的字段。 */
export function readBridgePick(value: unknown): CompositionBridgePick | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const rect = v.rect as Record<string, unknown> | null | undefined;
  if (typeof v.selector !== 'string' || !v.selector || !finite(v.w) || !finite(v.h) || typeof v.focusable !== 'boolean') return null;
  if (!optionalString(v.name) || !optionalString(v.role)) return null;
  if (typeof rect !== 'object' || rect === null || !finite(rect.x) || !finite(rect.y) || !finite(rect.w) || !finite(rect.h)) return null;
  return {
    selector: v.selector,
    w: v.w,
    h: v.h,
    ...(v.name ? { name: v.name as string } : {}),
    ...(v.role ? { role: v.role as string } : {}),
    focusable: v.focusable,
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
  };
}

/** 页面回的 `capture` 结果（不受信）验形：PNG 的 Blob、正整数边长不过上限；不合就当 `null`。 */
export function readBridgeCapture(value: unknown): CompositionBridgeCapture | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const side = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= CAPTURE_SIDE_MAX;
  if (!side(v.width) || !side(v.height)) return null;
  const image = v.image;
  if (!(image instanceof Blob) || image.type !== 'image/png' || image.size <= 0 || image.size > CAPTURE_BYTES_MAX) return null;
  return { width: v.width, height: v.height, image };
}

/** 取到的这一帧：页面画的 PNG，与它此刻在画布上的摆法（画布像素）。 */
export interface LiveCapture {
  itemId: Id;
  image: Blob;
  matrix: Matrix;
  opacity: number;
}

/**
 * 画布像素 → 合成的固有像素：`matrix` 把单位方块映到画布，固有像素 (px, py) 在画布上是 `M·(px/width, py/height)`，这里求逆。
 * 矩阵退化（行列式近 0）时是 null。
 */
export function canvasToIntrinsic(matrix: Matrix, size: { width: number; height: number }, point: { x: number; y: number }) {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (!(Math.abs(det) > 1e-9) || !(size.width > 0) || !(size.height > 0)) return null;
  const dx = point.x - e;
  const dy = point.y - f;
  return { x: ((d * dx - c * dy) / det) * size.width, y: ((a * dy - b * dx) / det) * size.height };
}

/** 固有像素的框 → 画布像素：四个角正变换后取外包盒。 */
export function intrinsicRectToCanvas(matrix: Matrix, size: { width: number; height: number }, rect: Rect): Rect {
  const [a, b, c, d, e, f] = matrix;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ] as const) {
    const u = px / size.width;
    const v = py / size.height;
    xs.push(a * u + c * v + e);
    ys.push(b * u + d * v + f);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

type BridgeResult = CompositionBridgeResponse['result'];
type FrameState = 'loading' | 'ready' | 'failed' | 'disposed';
/** 在视的那个此刻怎么摆（变了才写样式）。 */
interface Shown {
  itemId: Id;
  frame: number;
  layer: LiveLayer;
  transform: string;
  opacity: string;
}

/** 一个 iframe 与它的桥。 */
class LiveFrame {
  readonly candidate: LiveCandidate;
  readonly element: HTMLIFrameElement;
  state: FrameState = 'loading';
  /** 最近一次定位落地的时刻（秒）；还没有是 null。 */
  arrived: number | null = null;
  readonly #fail: (reason: string) => void;
  readonly #arrive: () => void;
  readonly #pending = new Map<number, (result: BridgeResult) => void>();
  #nextId = 1;
  #inFlight = false;
  /** 已经发过 `ready`：页面重新载入再发 `hello` 时照旧回 `ready`，但不重新计时。 */
  #readyAsked = false;
  #wanted: number | null = null;
  /** 在路上的那个拾取，与路上来了、还没发的最新一个（更早没发的兑现 null）。 */
  #pickInFlight: ((value: CompositionBridgePick | null) => void) | null = null;
  #wantedPick: { x: number; y: number; settle: (value: CompositionBridgePick | null) => void } | null = null;
  /** 在路上的那次取图与兑现它的函数（拆掉、失败时兑现 null）。 */
  #capture: { promise: Promise<CompositionBridgeCapture | null>; settle: (value: CompositionBridgeCapture | null) => void } | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #readyTimeoutMs: number;
  readonly #port: BridgePort;
  readonly #unsubscribe: () => void;

  constructor(
    candidate: LiveCandidate,
    root: HTMLElement,
    resolve: ResolveBundle,
    port: (element: HTMLIFrameElement) => BridgePort,
    timeouts: { load: number; ready: number },
    fail: (reason: string) => void,
    arrive: () => void,
  ) {
    this.candidate = candidate;
    this.#readyTimeoutMs = timeouts.ready;
    this.#fail = fail;
    this.#arrive = arrive;
    const element = root.ownerDocument.createElement('iframe');
    element.setAttribute('sandbox', 'allow-scripts');
    element.setAttribute('inert', '');
    element.tabIndex = -1;
    element.title = '';
    element.dataset.liveItem = candidate.itemId;
    Object.assign(element.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: `${candidate.width}px`,
      height: `${candidate.height}px`,
      border: '0',
      transformOrigin: '0 0',
      pointerEvents: 'none',
      opacity: '0',
      background: 'transparent',
    });
    this.element = element;
    element.addEventListener('error', () => this.#failed('load-error'));
    this.#port = port(element);
    this.#unsubscribe = this.#port.subscribe((message) => this.#receive(message));
    this.#arm(timeouts.load, 'load-timeout');
    resolve(candidate.asset).then(
      (handle) => {
        if (this.state !== 'loading') return;
        // 要到地址了：载入页面从这里重新计时，不算要地址的那一程。
        this.#arm(timeouts.load, 'load-timeout');
        // sandbox 定好再挂进页面：有的宿主内置浏览器按挂上那一刻的 sandbox 拦，之后改不算。
        if (ownOrigin(handle, element)) element.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        root.append(element);
        element.src = handle.url + handle.entry;
      },
      () => this.#failed('bundle-unresolved'),
    );
  }

  /** 定位到合成的本地时刻；没就绪先记着，就绪了再发。 */
  seek(seconds: number): void {
    if (this.state === 'failed' || this.state === 'disposed') return;
    if (this.state === 'loading' || this.#inFlight) {
      this.#wanted = seconds;
      return;
    }
    this.#send(seconds);
  }

  /** 问页面这一点（固有像素）下最内层的节点；没就绪、超时、报错或被更新的一次顶掉都兑现 null。 */
  pick(x: number, y: number, timeoutMs: number): Promise<CompositionBridgePick | null> {
    if (this.state !== 'ready') return Promise.resolve(null);
    return new Promise((settle) => {
      if (this.#pickInFlight) {
        this.#wantedPick?.settle(null);
        this.#wantedPick = { x, y, settle };
        return;
      }
      this.#sendPick(x, y, settle, timeoutMs);
    });
  }

  /** 要页面此刻这一帧的 PNG；没就绪、超时、报错、回得不对都兑现 null。已有一次在路上就等它。 */
  capture(timeoutMs: number): Promise<CompositionBridgeCapture | null> {
    if (this.state !== 'ready') return Promise.resolve(null);
    if (this.#capture) return this.#capture.promise;
    const id = this.#nextId++;
    let settle!: (value: CompositionBridgeCapture | null) => void;
    const promise = new Promise<CompositionBridgeCapture | null>((resolve) => {
      settle = (value) => {
        if (this.#capture?.promise !== promise) return;
        this.#capture = null;
        clearTimeout(timer);
        this.#pending.delete(id);
        resolve(value);
      };
    });
    this.#capture = { promise, settle };
    const timer = setTimeout(() => settle(null), timeoutMs);
    this.#request({ channel: COMPOSITION_BRIDGE_CHANNEL, kind: 'capture', id }).then((result) =>
      settle(this.state === 'ready' && result.ok ? readBridgeCapture(result.value) : null),
    );
    return promise;
  }

  dispose(): void {
    if (this.state === 'disposed') return;
    const live = this.state === 'ready';
    this.#settlePicks();
    this.state = 'disposed';
    this.#clearTimer();
    this.#unsubscribe();
    if (live) this.#port.post({ channel: COMPOSITION_BRIDGE_CHANNEL, kind: 'dispose', id: this.#nextId++ });
    this.#pending.clear();
    this.element.remove();
  }

  #sendPick(x: number, y: number, settle: (value: CompositionBridgePick | null) => void, timeoutMs: number): void {
    const id = this.#nextId++;
    const finish = (value: CompositionBridgePick | null) => {
      if (this.#pickInFlight !== finish) return;
      this.#pickInFlight = null;
      clearTimeout(timer);
      this.#pending.delete(id);
      settle(value);
      const next = this.#wantedPick;
      this.#wantedPick = null;
      if (next) {
        if (this.state === 'ready') this.#sendPick(next.x, next.y, next.settle, timeoutMs);
        else next.settle(null);
      }
    };
    this.#pickInFlight = finish;
    const timer = setTimeout(() => finish(null), timeoutMs);
    this.#request({ channel: COMPOSITION_BRIDGE_CHANNEL, kind: 'pick', id, x, y }).then((result) =>
      finish(this.state === 'ready' && result.ok ? readBridgePick(result.value) : null),
    );
  }

  /** 挂着的拾取与取图一律兑现 null（拆掉、失败时）。 */
  #settlePicks(): void {
    this.#capture?.settle(null);
    const wanted = this.#wantedPick;
    this.#wantedPick = null;
    wanted?.settle(null);
    this.#pickInFlight?.(null);
  }

  #send(seconds: number): void {
    this.#inFlight = true;
    this.#wanted = null;
    this.#request({ channel: COMPOSITION_BRIDGE_CHANNEL, kind: 'seek', id: this.#nextId++, seconds }).then((result) => {
      if (this.state !== 'ready') return;
      this.#inFlight = false;
      if (!result.ok) {
        this.#failed(`seek:${result.code}`);
        return;
      }
      const first = this.arrived === null;
      this.arrived = seconds;
      if (this.#wanted !== null) this.#send(this.#wanted);
      if (first) this.#arrive();
    });
  }

  #receive(message: CompositionBridgeMessage): void {
    if (message.kind === 'hello') {
      if (this.state !== 'loading') return;
      const { contract, width, height, fps, durationFrames } = this.candidate;
      if (!this.#readyAsked) this.#arm(this.#readyTimeoutMs + READY_GRACE_MS, 'ready-timeout');
      this.#readyAsked = true;
      this.#request({
        channel: COMPOSITION_BRIDGE_CHANNEL,
        kind: 'ready',
        id: this.#nextId++,
        contract: contract as CodeBundleContract,
        timeoutMs: this.#readyTimeoutMs,
        context: { width, height, fps, durationFrames },
      }).then((result) => {
        if (this.state !== 'loading') return;
        if (!result.ok) {
          this.#failed(`ready:${result.code}`);
          return;
        }
        this.state = 'ready';
        this.#clearTimer();
        // 预载的意思：就位后第 0 帧（或这期间要过的那一帧）先画好。
        this.#send(this.#wanted ?? 0);
      });
      return;
    }
    if (message.kind === 'result') {
      const settle = this.#pending.get(message.id);
      if (!settle) return;
      this.#pending.delete(message.id);
      settle(message.result);
    }
  }

  #request(request: CompositionBridgeRequest): Promise<BridgeResult> {
    return new Promise((resolve) => {
      this.#pending.set(request.id, resolve);
      this.#port.post(request);
    });
  }

  #failed(reason: string): void {
    if (this.state === 'failed' || this.state === 'disposed') return;
    this.#settlePicks();
    this.#capture?.settle(null);
    this.state = 'failed';
    this.#clearTimer();
    this.element.style.opacity = '0';
    this.#fail(reason);
  }

  #arm(ms: number, reason: string): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => this.#failed(reason), ms);
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

export class LiveLayerHost implements LiveHost {
  readonly #root: HTMLElement;
  readonly #resolve: ResolveBundle;
  readonly #timeouts: { load: number; ready: number };
  readonly #pickTimeoutMs: number;
  readonly #captureTimeoutMs: number;
  readonly #maxMounted: number;
  readonly #port: (element: HTMLIFrameElement) => BridgePort;
  readonly #frames = new Map<Id, LiveFrame>();
  readonly #listeners = new Set<(itemId: Id, reason: string) => void>();
  readonly #loadingListeners = new Set<(loading: boolean) => void>();
  #loading = false;
  /** 舞台上一个画布像素占几个 CSS 像素。 */
  #scale = 1;
  #shown: Shown | null = null;
  #disposed = false;

  constructor(root: HTMLElement, resolve: ResolveBundle, options: LiveLayerHostOptions = {}) {
    this.#root = root;
    this.#resolve = resolve;
    this.#timeouts = { load: options.loadTimeoutMs ?? LOAD_TIMEOUT_MS, ready: options.readyTimeoutMs ?? READY_TIMEOUT_MS };
    this.#pickTimeoutMs = options.pickTimeoutMs ?? PICK_TIMEOUT_MS;
    this.#captureTimeoutMs = options.captureTimeoutMs ?? CAPTURE_TIMEOUT_MS;
    this.#maxMounted = options.maxMounted ?? MAX_MOUNTED;
    this.#port = options.port ?? windowPort;
  }

  /** 画面在舞台上的显示比例（画布像素 → CSS 像素）；变了重新摆在视的那个。 */
  setScale(scale: number): void {
    if (!(scale > 0) || scale === this.#scale) return;
    this.#scale = scale;
    const shown = this.#shown;
    if (shown) {
      const frame = this.#frames.get(shown.itemId);
      if (frame) this.#place(frame, this.#placement(frame, shown.layer, shown.frame));
    }
  }

  prepare(candidates: readonly LiveCandidate[]): void {
    if (this.#disposed) return;
    const wanted = candidates.slice(0, this.#maxMounted);
    const keep = new Set(wanted.map((c) => c.itemId));
    for (const [itemId, frame] of this.#frames) {
      const next = wanted.find((c) => c.itemId === itemId);
      if (next && next.asset.id === frame.candidate.asset.id && next.asset.revision === frame.candidate.asset.revision) continue;
      frame.dispose();
      this.#frames.delete(itemId);
      if (!next) keep.delete(itemId);
    }
    for (const candidate of wanted) {
      if (this.#frames.has(candidate.itemId)) continue;
      const frame = new LiveFrame(
        candidate,
        this.#root,
        this.#resolve,
        this.#port,
        this.#timeouts,
        (reason) => this.#failed(candidate.itemId, reason),
        () => this.#updateLoading(),
      );
      this.#frames.set(candidate.itemId, frame);
    }
    this.#updateLoading();
  }

  show(layer: LiveLayer | null, frame: number): void {
    if (this.#disposed) return;
    for (const [itemId, live] of this.#frames) {
      if (!layer || itemId !== layer.itemId) {
        if (live.element.style.opacity !== '0') live.element.style.opacity = '0';
        continue;
      }
      const same = this.#shown?.itemId === itemId && this.#shown.frame === frame;
      this.#place(live, this.#placement(live, layer, frame));
      if (!same) live.seek(layer.sourceSeconds);
    }
    if (!layer || !this.#frames.has(layer.itemId)) this.#shown = null;
    this.#updateLoading();
  }

  /**
   * 画布上这一点（画布像素）下，在视的那个合成里最内层的节点（lite-editor §11 第 12 条）。没有在视的、它还没就绪、点不在合成里、
   * 页面没回或回得不对，都是 null。
   */
  async pick(point: { x: number; y: number }): Promise<LivePick | null> {
    const shown = this.#shown;
    const frame = shown && !this.#disposed ? this.#frames.get(shown.itemId) : undefined;
    if (!shown || !frame || frame.state !== 'ready') return null;
    const size = { width: frame.candidate.width, height: frame.candidate.height };
    const at = canvasToIntrinsic(shown.layer.matrix, size, point);
    if (!at || at.x < 0 || at.y < 0 || at.x > size.width || at.y > size.height) return null;
    const node = await frame.pick(at.x, at.y, this.#pickTimeoutMs);
    if (!node) return null;
    return { itemId: shown.itemId, rect: intrinsicRectToCanvas(shown.layer.matrix, size, node.rect), node };
  }

  /**
   * 在视的那个此刻这一帧（Web 截图模式，lite-editor §4.1）：页面画的 PNG 加上它在画布上的摆法。没有在视的、它还没就绪或还没画出第一帧、
   * 页面画不全（回 `null`）、没回或回得不对，都是 null。摆法取发请求那一刻在视的这一帧，与页面画的是同一帧。
   */
  async capture(): Promise<LiveCapture | null> {
    const shown = this.#shown;
    const frame = shown && !this.#disposed ? this.#frames.get(shown.itemId) : undefined;
    if (!shown || !frame || frame.state !== 'ready' || frame.arrived === null) return null;
    const got = await frame.capture(this.#captureTimeoutMs);
    if (!got) return null;
    return { itemId: shown.itemId, image: got.image, matrix: shown.layer.matrix, opacity: shown.layer.opacity };
  }

  onFailure(listener: (itemId: Id, reason: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onLoading(listener: (loading: boolean) => void): () => void {
    this.#loadingListeners.add(listener);
    listener(this.#loading);
    return () => this.#loadingListeners.delete(listener);
  }

  /** 诊断与测试：挂着的 iframe 按实例。 */
  get mounted(): ReadonlyMap<Id, { element: HTMLIFrameElement; state: FrameState; arrived: number | null }> {
    return this.#frames;
  }

  dispose(): void {
    this.#disposed = true;
    for (const frame of this.#frames.values()) frame.dispose();
    this.#frames.clear();
    this.#listeners.clear();
    this.#shown = null;
    this.#updateLoading();
    this.#loadingListeners.clear();
  }

  /** 在视的那个画出第一帧没有：挂上、摆上、第一次定位回信、失败、拆掉都重新算，变了才通知。 */
  #updateLoading(): void {
    const shown = this.#shown;
    const frame = shown && !this.#disposed ? this.#frames.get(shown.itemId) : undefined;
    const loading = frame !== undefined && (frame.state === 'loading' || frame.state === 'ready') && frame.arrived === null;
    if (loading === this.#loading) return;
    this.#loading = loading;
    for (const listener of this.#loadingListeners) listener(loading);
  }

  /** 按矩阵与显示比例算 iframe 的摆法：矩阵把固有尺寸映到画布像素，再乘显示比例。 */
  #placement(live: LiveFrame, layer: LiveLayer, frame: number): Shown {
    const [a, b, c, d, e, f] = layer.matrix;
    const s = this.#scale;
    const { width, height } = live.candidate;
    const transform = `matrix(${(a * s) / width}, ${(b * s) / width}, ${(c * s) / height}, ${(d * s) / height}, ${e * s}, ${f * s})`;
    const opacity = String(live.state === 'failed' ? 0 : layer.opacity);
    return { itemId: live.candidate.itemId, frame, layer, transform, opacity };
  }

  #place(live: LiveFrame, shown: Shown): void {
    const previous = this.#shown;
    if (previous?.itemId !== shown.itemId || previous.transform !== shown.transform) live.element.style.transform = shown.transform;
    if (previous?.itemId !== shown.itemId || previous.opacity !== shown.opacity) live.element.style.opacity = shown.opacity;
    this.#shown = shown;
  }

  #failed(itemId: Id, reason: string): void {
    for (const listener of this.#listeners) listener(itemId, reason);
    this.#updateLoading();
  }
}
