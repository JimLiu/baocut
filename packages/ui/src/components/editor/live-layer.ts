import {
  isCompositionBridgeMessage,
  COMPOSITION_BRIDGE_CHANNEL,
  type BundleHandle,
  type CodeBundleContract,
  type CompositionBridgeMessage,
  type CompositionBridgeRequest,
  type CompositionBridgeResponse,
  type Id,
  type VersionRef,
} from '@baocut/protocol';
import type { LiveCandidate } from '../../model/live-composition.ts';
import type { LiveLayer } from '../../render/frame-plan.ts';

/**
 * 实时合成层的宿主（动效视频设计 §4.1–§4.3）：舞台画布底下的沙箱 `<iframe>`，每个要实时播的代码包合成一个。
 *
 * - iframe 带 `sandbox="allow-scripts"`（不开 `allow-same-origin`，来源不透明；媒体通道的响应头还带同样的 `sandbox`），
 *   `inert`、`pointer-events: none`：指针与键盘都进不了包，舞台点选照旧按实例的几何盒算。
 * - 页面经 `media.bundle` 的目录句柄载入（每次挂上都重新要一个，句柄有期限）；入口页面里注好了取帧脚本与桥，
 *   页面发 `hello` 之后宿主发 `ready`，就位后先定位到第 0 帧（预载的意思就是这一步做完）。
 * - `seek` 一次只发一个在路上的：播放中一个视频帧只送一次，没回来之前又来了新的就只记最新的，回来再发。
 *   页面里的取帧脚本等两次 `requestAnimationFrame` 才回信，回信到了就是「到了」。
 * - 载入失败、`ready` 或 `seek` 报错、`readyTimeoutMs` 内没就绪：报给引擎，由引擎把这件拉黑、退回替身或占位。
 * - 在视的那个按帧计划的 `matrix` 摆（按清单固有尺寸布置页面再 CSS 变换），其余预载的留在版面里但不显示
 *   （`opacity: 0`，不用 `display: none`，否则页面的动画帧不跑）。最多挂 `maxMounted` 个。
 */

export interface LiveHost {
  /** 该挂着的合成（在视的排第一）：挂上没有的、拆掉不在列表里的。 */
  prepare(candidates: readonly LiveCandidate[]): void;
  /** 这一帧的实时层（没有时 null）：摆位、送这一帧的本地时刻。`frame` 是视频帧号，同一帧不重送。 */
  show(layer: LiveLayer | null, frame: number): void;
  onFailure(listener: (itemId: Id, reason: string) => void): () => void;
}

export type ResolveBundle = (asset: VersionRef) => Promise<BundleHandle>;

/** iframe 与页面之间的信道：默认是 `contentWindow.postMessage` 与窗口的 `message` 事件；测试换成假的。 */
export interface BridgePort {
  post(request: CompositionBridgeRequest): void;
  /** 只交来自这个 iframe 的桥消息；返回取消订阅的函数。 */
  subscribe(listener: (message: CompositionBridgeMessage) => void): () => void;
}

export interface LiveLayerHostOptions {
  readyTimeoutMs?: number;
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

const READY_TIMEOUT_MS = 3000;
const MAX_MOUNTED = 3;

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
  readonly #pending = new Map<number, (result: BridgeResult) => void>();
  #nextId = 1;
  #inFlight = false;
  #wanted: number | null = null;
  #timer: ReturnType<typeof setTimeout> | null;
  readonly #port: BridgePort;
  readonly #unsubscribe: () => void;

  constructor(
    candidate: LiveCandidate,
    root: HTMLElement,
    resolve: ResolveBundle,
    port: (element: HTMLIFrameElement) => BridgePort,
    readyTimeoutMs: number,
    fail: (reason: string) => void,
  ) {
    this.candidate = candidate;
    this.#fail = fail;
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
    root.append(element);
    this.#port = port(element);
    this.#unsubscribe = this.#port.subscribe((message) => this.#receive(message));
    this.#timer = setTimeout(() => this.#failed('ready-timeout'), readyTimeoutMs);
    resolve(candidate.asset).then(
      (handle) => {
        if (this.state !== 'loading') return;
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

  dispose(): void {
    if (this.state === 'disposed') return;
    const live = this.state === 'ready';
    this.state = 'disposed';
    this.#clearTimer();
    this.#unsubscribe();
    if (live) this.#port.post({ channel: COMPOSITION_BRIDGE_CHANNEL, kind: 'dispose', id: this.#nextId++ });
    this.#pending.clear();
    this.element.remove();
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
      this.arrived = seconds;
      if (this.#wanted !== null) this.#send(this.#wanted);
    });
  }

  #receive(message: CompositionBridgeMessage): void {
    if (message.kind === 'hello') {
      if (this.state !== 'loading') return;
      const { contract, width, height, fps, durationFrames } = this.candidate;
      this.#request({
        channel: COMPOSITION_BRIDGE_CHANNEL,
        kind: 'ready',
        id: this.#nextId++,
        contract: contract as CodeBundleContract,
        timeoutMs: READY_TIMEOUT_MS,
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
    this.state = 'failed';
    this.#clearTimer();
    this.element.style.opacity = '0';
    this.#fail(reason);
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

export class LiveLayerHost implements LiveHost {
  readonly #root: HTMLElement;
  readonly #resolve: ResolveBundle;
  readonly #readyTimeoutMs: number;
  readonly #maxMounted: number;
  readonly #port: (element: HTMLIFrameElement) => BridgePort;
  readonly #frames = new Map<Id, LiveFrame>();
  readonly #listeners = new Set<(itemId: Id, reason: string) => void>();
  /** 舞台上一个画布像素占几个 CSS 像素。 */
  #scale = 1;
  #shown: Shown | null = null;
  #disposed = false;

  constructor(root: HTMLElement, resolve: ResolveBundle, options: LiveLayerHostOptions = {}) {
    this.#root = root;
    this.#resolve = resolve;
    this.#readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
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
      const frame = new LiveFrame(candidate, this.#root, this.#resolve, this.#port, this.#readyTimeoutMs, (reason) =>
        this.#failed(candidate.itemId, reason),
      );
      this.#frames.set(candidate.itemId, frame);
    }
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
  }

  onFailure(listener: (itemId: Id, reason: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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
  }
}
