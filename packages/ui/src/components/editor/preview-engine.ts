import type { AssetRecord, DocumentRecord, FontFaceQuery, Id, Revision, Sequence, VersionRef } from '@baocut/protocol';
import { durationSeconds, videoSlots } from '../../model/editor.ts';
import { LIVE_CAPTION_ITEM_ID, liveCaptionCues, liveCaptionDocuments, withLiveCaption, type LiveCue } from '../../model/live-caption.ts';
import { captionView, type CaptionMode } from '../../model/player.ts';
import type { AssetDecoder, AssetSource } from '../../render/asset-source.ts';
import { SPECTRUM_MAX_BYTES, spectrumDecoder } from '../../render/audio-spectrum.ts';
import { isMediaLayer, type FramePlan, type MediaLayer, type VisualLayer } from '../../render/frame-plan.ts';
import type { FontSource, LoadedFace } from '../../render/local-fonts.ts';
import { paintSize } from '../../render/playback-quality.ts';
import { loadRenderPlanner } from '../../render/preview-wasm.ts';
import {
  PlanFailure,
  type CaptionHit,
  type FrozenDocument,
  type MissingSpectrum,
  type RenderPlanner,
  type RenderedFrame,
  type SpeechTranscript,
} from '../../render/render-planner.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';
import { PreviewWatch, probeElement, type MediaProbe, type PreviewSnapshot, type StallReport } from './preview-watch.ts';

/**
 * 预览的播放驱动（产品设计 §5.4「当前工作稿」，架构设计 §9.4 Interactive 档）。
 *
 * 每一刻先问帧计划器（Rust `render-graph` 编成的 WASM）这一帧有哪些层、怎么摆、各取源的哪一刻、哪些声音在响，
 * 再按计划驱动隐藏的媒体元素。画面由同一个 WASM 里的 `frame-render`（与导出同一个实现）画：界面只把媒体元素
 * 这一刻的画面、字幕文档的正文、Lottie 与 SVG、GIF 图片的字节与声波要的素材频谱送进去，取回一帧 RGBA 放到画布上。播放时以墙上时钟为准推进播放头，
 * 媒体元素偏得多了再校正；这一档允许掉帧，严格的逐帧输出是导出的事。
 *
 * 视频元素按素材分槽：同一素材同一时刻出现在几处就要几个元素（各自定位）。实例尽量留在原来的槽里，
 * 拆开的两段接得上；音频轨道上的实例各用一个元素，图片按素材共用一个。
 *
 * 视频层不一定来自视频实例（带预渲染替身的合成也按视频层出画面与声音）：用哪个素材只看计划里的层与声音自己带的
 * `asset`，不回头查实例。
 */

export type MediaKey = string;

export function videoKey(asset: VersionRef, slot: number): MediaKey {
  return `v:${asset.id}:${asset.revision}#${slot}`;
}

export function imageKey(asset: VersionRef): MediaKey {
  return `i:${asset.id}:${asset.revision}`;
}

export function audioKey(itemId: Id): MediaKey {
  return `a:${itemId}`;
}

/** `problems`：这一帧有画不出来的东西（认不出的样式、没有预渲染的代码包等），画面照常出，另外报出来。 */
export type PreviewStatus = { kind: 'loading' } | { kind: 'ready'; problems?: string[] } | { kind: 'error'; message: string };

/** 文档正文从哪里来（界面里是视频的文档缓存）。 */
export interface DocumentSource {
  /** 已经取到的正文；还没有是 undefined。 */
  peek(documentId: Id, revision: Revision): unknown;
  /** 还没有就去取，取到之后由缓存通知重画。 */
  load(documentId: Id, revision: Revision): void;
}

/** 预览要的文档正文（字幕与字幕样式）：取到之后通知重画。 */
export interface PreviewDocuments extends DocumentSource {
  subscribe(listener: () => void): () => void;
  /** 忘掉还在路上的请求（预览卡住时的「重试」）：之后再要就重新发，路上的回来也不收。 */
  forgetPending?(): void;
}

/** 预览要的素材内容（Lottie 与 SVG、GIF 图片的字节、声波要的素材频谱）：取到之后通知重画。 */
export interface PreviewAssets extends AssetSource {
  subscribe(listener: () => void): () => void;
  /** 同 `PreviewDocuments.forgetPending`。 */
  forgetPending?(): void;
}

/**
 * 预览要的媒体是不是在等兼容副本（浏览器放不了的 WebM，Runtime 在转换，`media.playback` 回 pending）：转换到了几成
 * （0–1，Runtime 还不知道时 null），不在等是 undefined。卡住诊断用它分清「在转换」与「在等媒体」。
 */
export type PreviewPreparing = (asset: VersionRef) => number | null | undefined;

/** 视频或图片层的源元素。 */
export type SourceElement = HTMLVideoElement | HTMLImageElement;

/** 素材的原始字节（Lottie 与 SVG、GIF 图片由 WASM 自己解）。 */
const BYTES: AssetDecoder<Uint8Array> = {
  name: 'bytes',
  decode: async (response) => new Uint8Array(await response.arrayBuffer()),
};

/**
 * 最近一次播放的计数（架构设计 §9.12，`npm run bench:preview` 读它）：从 `play()` 起累计，停下之后保留到下一次播放。
 * 逐 tick 的样本最多留 `STATS_SAMPLES` 个。
 */
export interface PlaybackStats {
  /** 播放的 tick（每次 requestAnimationFrame 回调一次）。 */
  ticks: number;
  /** 还在同一个视频帧上、画布上已经是这一帧，不重画的 tick。 */
  repeated: number;
  /** 画到画布上的帧。 */
  presented: number;
  /** 有层还在定位、留着上一帧的 tick。 */
  held: number;
  /** 播放中把媒体元素重新定位的次数：每一次声音都会断一下。 */
  resyncs: number;
  /** 每个 tick 在主线程上花的毫秒（对元素、送画面、画、放上画布，加上通知播放头时同步跑的界面更新）。 */
  tickMs: number[];
  /** 画出的每一帧是视频的第几帧（帧计划的 `frame`）：数得出掉了哪些帧。 */
  frames: number[];
  /** 画出的帧里送画面（含从媒体元素读像素）与在 WASM 里画各花的毫秒。 */
  uploadMs: number[];
  renderMs: number[];
  /** 出声或出画面的媒体元素与计划的偏差（秒，绝对值），每个 tick 每个元素一个。 */
  drift: number[];
  /** 画帧用的像素尺寸（最近一帧）。 */
  size: { width: number; height: number } | null;
}

const STATS_SAMPLES = 20_000;

function emptyStats(): PlaybackStats {
  return {
    ticks: 0,
    repeated: 0,
    presented: 0,
    held: 0,
    resyncs: 0,
    tickMs: [],
    frames: [],
    uploadMs: [],
    renderMs: [],
    drift: [],
    size: null,
  };
}

function sample(values: number[], value: number): void {
  if (values.length < STATS_SAMPLES) values.push(value);
}

/** 画布 → 画它的引擎（诊断与基准用：从页面上的预览画布找到引擎）。 */
const enginesByCanvas = new WeakMap<HTMLCanvasElement, PreviewEngine>();

export function previewEngineOf(canvas: HTMLCanvasElement): PreviewEngine | undefined {
  return enginesByCanvas.get(canvas);
}

export interface PreviewCallbacks {
  /** 播放头前进了（播放中每一帧调用一次）。 */
  onTime(seconds: number): void;
  /** 播放到结尾自己停了。 */
  onEnded(): void;
}

/** 播放中偏得超过这么多才重新定位，小的偏差用播放速度追。 */
const RESYNC_SECONDS = 0.25;
/** 暂停时要逐帧对准。 */
const EXACT_SECONDS = 1e-3;
/** 媒体元素收得下的播放速度（浏览器的 playbackRate 范围）。 */
const MIN_RATE = 0.0625;
const MAX_RATE = 16;
/** 有层还在定位时先不画（留着上一帧），最多等这么久，之后照画，免得一直停在旧画面上。 */
const HOLD_PLAYING_MS = 250;
const HOLD_PAUSED_MS = 1000;
/** 写了 `speaker` 的声波在没有转写、转写里没有这位说话人时的提示（内核报的，见 frame-render）。 */
// i18n-ignore: 匹配渲染内核报来的提示原文（frame-render），内核文案改了这里跟着改
const SPEAKER_NOTE = /：(视频里没有转写，听不出说话人|转写里没有说话人) /;
/**
 * 停着定位之后这么久没再定位才算停下。这之间还在定位的视频先用它上一张画面（不等定位落地）；接连定位（拖动播放头、
 * 按住逐帧）按播放的分辨率画。两样都不是精确的那一帧，停下再按原尺寸画。
 */
const SCRUB_SETTLE_MS = 200;

interface Target {
  seconds: number;
  rate: number;
  muted: boolean;
  volume: number;
}

type Readiness = 'ready' | 'pending' | 'absent';

export class PreviewEngine {
  readonly #elements = new Map<MediaKey, SourceElement | HTMLAudioElement>();
  readonly #callbacks: PreviewCallbacks;
  readonly #load: (options?: { fresh?: boolean }) => Promise<RenderPlanner>;
  readonly #statusListeners = new Set<(status: PreviewStatus) => void>();
  #status: PreviewStatus = { kind: 'loading' };
  #planner: RenderPlanner | null = null;
  #video: { sequence: Sequence; assets: Record<Id, AssetRecord> } | null = null;
  #videoError: string | null = null;
  #slotCounts = new Map<string, number>();
  /** 出视频层或自带声音的实例（视频，或带预渲染替身的合成）→ 它占着的元素。 */
  readonly #slotOf = new Map<Id, MediaKey>();
  #plan: FramePlan | null = null;
  #captionHits: readonly CaptionHit[] = [];
  readonly #captionListeners = new Set<(hits: readonly CaptionHit[]) => void>();
  readonly #planListeners = new Set<(plan: FramePlan) => void>();
  #context: CanvasRenderingContext2D | null = null;
  #scale = 1;
  #time = 0;
  #playing = false;
  #tick = 0;
  #clockStart = 0;
  #timeStart = 0;
  #paintTimer: ReturnType<typeof setTimeout> | null = null;
  #holdSince: number | null = null;
  /** 画布上现在是哪一帧（序列版本与帧号）；播放中同一帧不重画。 */
  #painted: { revision: string; frame: number } | null = null;
  /** 播放中有东西变了（文档、素材、字体、尺寸、媒体元素的状态）：这一帧要重画。 */
  #dirty = false;
  /** 停着定位之后还没停下（见 `SCRUB_SETTLE_MS`）；到时由计时器收尾、画精确的那一帧。 */
  #scrubTimer: ReturnType<typeof setTimeout> | null = null;
  /** 停下之前又定位了（在拖动）。 */
  #dragging = false;
  /** 每个媒体元素最近读出的画面：拖动中元素还在定位时先用它（画面晚到，内容照旧）。 */
  readonly #lastPictures = new WeakMap<SourceElement, ImageData>();
  /** 画布上是不是停住那一刻按原尺寸、等齐了媒体画出的帧（与导出同一帧）。 */
  #exact = false;
  /** 画布上出过没有还在来的媒体的一帧（不是等着媒体时的黑帧）；重试、换一部视频之后从头算。 */
  #pictured = false;
  readonly #pictureListeners = new Set<(pictured: boolean) => void>();
  #disposed = false;
  readonly #documents: PreviewDocuments | null;
  readonly #assets: PreviewAssets | null;
  #documentRecords: Record<Id, DocumentRecord> = {};
  /** 上次送进 WASM 的文档（按正文对象比较，草稿变了正文对象就变）。 */
  #sentDocuments: FrozenDocument[] | null = null;
  /** 上次送进 WASM 的转写（按正文对象比较）。 */
  #sentSpeech: SpeechTranscript[] = [];
  /** 从媒体元素读像素用的画布。 */
  #scratch: CanvasRenderingContext2D | null = null;
  #stats: PlaybackStats = emptyStats();
  /** 卡住时点名卡在哪一步的开发日志（见 preview-watch）。 */
  readonly #watch = new PreviewWatch(() => this.#snapshot());
  #unwatch: (() => void)[] | null = null;
  /** 第几次接渲染内核：重试之后，之前那次迟到的结果不收。 */
  #attach = 0;
  #problems: string[] = [];
  /** 要的转写里还有没取到的：声波的说话人提示先不报（取到之前内核当作没有转写）。 */
  #speechLoading = false;
  /** 素材频谱的解码器（用计划器的模块分析），第一次要频谱时建。 */
  #spectrum: AssetDecoder<Uint8Array> | null = null;
  /** 监听音量（快捷键 ↑/↓、M，见 model/preview-volume）：乘在每个声音上，只是这个窗口听到的大小。 */
  #monitor = { volume: 1, muted: false };
  readonly #monitorListeners = new Set<(monitor: { volume: number; muted: boolean }) => void>();
  /** 播放倍速（舞台工具条与全屏播放器的倍速菜单，同一份）：时钟与媒体元素一起乘，只是这个窗口看的快慢。 */
  #rate = 1;
  /**
   * 字幕档位（model/player `captionView`）：全屏播放器的四档，或舞台工具条隐藏字幕时的 `off`。送去画的序列上临时停用不该露的字幕，
   * `off` 连转录中的临时字幕也不叠；`null` 照视频原样画。
   */
  #captionMode: CaptionMode | null = null;
  readonly #fonts: FontSource | null;
  readonly #preparing: PreviewPreparing | null;
  /** 报过缺的字体族（常设：渲染内核重新载入后也照这份去要）。 */
  readonly #fontsMissing = new Set<string>();
  /** 问过本机字体的 face（每个只问一次，键是族名、字重与斜体）与还在取的 face 的族。 */
  readonly #fontsAsked = new Set<string>();
  #fontsLoading = new Map<string, number>();
  /** 转录中画面上的临时字幕（`setLiveCaption`），按转写 Job；只在预览里画，不进视频。 */
  readonly #liveCues = new Map<Id, readonly LiveCue[]>();
  /** 临时字幕层的两份文档：句子变了才重建，正文对象不变就不重送。 */
  #liveDocuments: FrozenDocument[] | null = null;

  constructor(
    callbacks: PreviewCallbacks,
    load: (options?: { fresh?: boolean }) => Promise<RenderPlanner> = loadRenderPlanner,
    documents: PreviewDocuments | null = null,
    assets: PreviewAssets | null = null,
    fonts: FontSource | null = null,
    preparing: PreviewPreparing | null = null,
  ) {
    this.#callbacks = callbacks;
    this.#load = load;
    this.#documents = documents;
    this.#assets = assets;
    this.#fonts = fonts;
    this.#preparing = preparing;
    this.#watchSources();
    this.#watch.start();
    this.#attachPlanner();
  }

  /** 字幕的文档正文、Lottie 或 SVG、GIF 图片的字节到了：停着时重画（播放中下一帧自然会画）。 */
  #watchSources(): void {
    this.#unwatch ??= [this.#documents, this.#assets].flatMap((source) => (source ? [source.subscribe(() => this.#requestPaint())] : []));
  }

  #attachPlanner(fresh = false): void {
    const attach = ++this.#attach;
    this.#load(fresh ? { fresh } : undefined)
      .then(
        (planner) => {
          if (this.#disposed || attach !== this.#attach) return;
          this.#planner = planner;
          // WASM 陷阱之后计划器会自己重新载入；好了再对一次。
          planner.onRecovered = () => this.#refresh();
          this.#loadVideo();
          this.#refresh();
        },
        (error: Error) => {
          if (attach === this.#attach) this.#setStatus({ kind: 'error', message: E.rendererFailed(error.message) });
        },
      )
      // i18n-ignore: 开发日志
      .catch((error: unknown) => this.#watch.noteError('载入渲染内核之后', error));
  }

  /**
   * `dispose` 之后接着用。React 开发模式（StrictMode）挂载时会把效果多跑一轮清理与建立，而引擎还是同一个：
   * 不接回来，预览就一直停在载入中。
   */
  resume(): void {
    if (!this.#disposed) return;
    this.#disposed = false;
    this.#watchSources();
    this.#watch.start();
    if (this.#planner) this.#refresh();
    else this.#attachPlanner();
  }

  onStatus(listener: (status: PreviewStatus) => void): () => void {
    this.#statusListeners.add(listener);
    listener(this.#status);
    return () => this.#statusListeners.delete(listener);
  }

  /** 页面里的源元素：视频按槽、图片按素材、音频按实例（键见 `videoKey` 等）。 */
  register(key: MediaKey, element: SourceElement | HTMLAudioElement | null): void {
    const previous = this.#elements.get(key);
    if (previous === element) return;
    if (previous) this.#listen(previous, false);
    if (element) {
      this.#elements.set(key, element);
      this.#listen(element, true);
    } else this.#elements.delete(key);
    this.#refresh();
  }

  /** 合成用的画布；`scale` 是画布像素相对序列画布的比例。 */
  attachCanvas(canvas: HTMLCanvasElement | null, scale = this.#scale): void {
    this.#context = canvas?.getContext('2d') ?? null;
    if (canvas) enginesByCanvas.set(canvas, this);
    this.#scale = scale;
    this.#requestPaint();
  }

  setScale(scale: number): void {
    if (scale === this.#scale || !(scale > 0)) return;
    this.#scale = scale;
    this.#requestPaint();
  }

  setVideo(sequence: Sequence, assets: Record<Id, AssetRecord>, documents: Record<Id, DocumentRecord> = {}): void {
    if (this.#video && this.#video.sequence.id !== sequence.id) this.#setPictured(false);
    this.#video = { sequence, assets };
    this.#documentRecords = documents;
    this.#slotCounts = new Map(videoSlots(sequence).map(({ asset, count }) => [`${asset.id}:${asset.revision}`, count]));
    this.#loadVideo();
    this.#refresh();
  }

  /**
   * 转录中画面上的临时字幕（产品设计 §5.7，`model/live-caption.ts`）：一次转录一组句子（序列秒），`null` 收起。叠在送给
   * 渲染内核的序列上、与真字幕同一条路画；不进视频、不进撤销、不进导出，舞台点选也点不中它。
   */
  setLiveCaption(jobId: Id, cues: readonly LiveCue[] | null): void {
    if (cues?.length) this.#liveCues.set(jobId, cues);
    else if (!this.#liveCues.delete(jobId)) return;
    const all = [...this.#liveCues.values()].flat();
    this.#liveDocuments = all.length ? liveCaptionDocuments(liveCaptionCues(all)) : null;
    this.#dirty = true;
    this.#loadVideo();
    this.#refresh();
  }

  get playing(): boolean {
    return this.#playing;
  }

  get time(): number {
    return this.#time;
  }

  /** 画布上是不是停住那一刻的精确画面：播放中、拖动中、等不及定位与缺了媒体画出的都不是。 */
  get exact(): boolean {
    return this.#exact;
  }

  /**
   * 这部视频的画面出来过没有：画布上出过这一刻没有还在来的媒体的一帧（没有媒体的帧也算，载入失败的不算在来）。
   * 没出来之前舞台盖着载入面板（产品设计 §5.1「预览载入与卡住」），不露出等着媒体时的黑帧；重试与换一部视频之后从头算。
   */
  get pictured(): boolean {
    return this.#pictured;
  }

  /** `pictured` 变了时通知；订阅时先给一次当前的。 */
  onPicture(listener: (pictured: boolean) => void): () => void {
    this.#pictureListeners.add(listener);
    listener(this.#pictured);
    return () => this.#pictureListeners.delete(listener);
  }

  get monitor(): { volume: number; muted: boolean } {
    return this.#monitor;
  }

  /** 换监听音量：停着时元素都暂停，下一次对元素时生效；播放中下一帧就生效。不进视频、不影响导出。 */
  setMonitor(monitor: { volume: number; muted: boolean }): void {
    this.#monitor = { volume: Math.max(0, Math.min(1, monitor.volume)), muted: monitor.muted };
    for (const listener of this.#monitorListeners) listener(this.#monitor);
  }

  /** 监听音量变了时通知（全屏播放器的音量钮与滑杆）；订阅时先给一次当前的。 */
  onMonitor(listener: (monitor: { volume: number; muted: boolean }) => void): () => void {
    this.#monitorListeners.add(listener);
    listener(this.#monitor);
    return () => this.#monitorListeners.delete(listener);
  }

  get rate(): number {
    return this.#rate;
  }

  /** 换播放倍速：播放中从此刻起按新倍速走（时钟在这一刻重新起算），媒体元素下一帧跟上。不进视频、不影响导出。 */
  setRate(rate: number): void {
    const next = Math.max(MIN_RATE, Math.min(MAX_RATE, rate));
    if (!(next > 0) || next === this.#rate) return;
    if (this.#playing) {
      const now = performance.now();
      this.#timeStart += ((now - this.#clockStart) / 1000) * this.#rate;
      this.#clockStart = now;
    }
    this.#rate = next;
    if (this.#playing) this.#sync();
  }

  /** 字幕档位（全屏的四档、舞台隐藏字幕的 `off`）：按档位停用不该露的字幕再交给渲染内核，`null` 回到视频原样。不进视频、不进撤销、不影响导出。 */
  setCaptionView(mode: CaptionMode | null): void {
    if (mode === this.#captionMode) return;
    this.#captionMode = mode;
    this.#dirty = true;
    this.#loadVideo();
    this.#refresh();
  }

  /**
   * 这几个族刚下载好（字体条的「下载」、重试、导出里下载的）：问过、没取到的 face 忘掉，重画一次时再去要。
   * 预览每个 face 只问一次，不这样的话之前报缺的族要到重新打开视频才换上。
   */
  retryFonts(families: readonly string[]): void {
    const names = new Set(families.map((f) => f.trim().toLowerCase()));
    let changed = false;
    for (const key of [...this.#fontsAsked]) {
      const family = key.split('\u0000')[0]!;
      if (names.has(family.trim().toLowerCase()) && !this.#fontsLoading.has(family)) {
        this.#fontsAsked.delete(key);
        changed = true;
      }
    }
    if (changed && !this.#disposed) this.#requestPaint();
  }

  /** 最近一次播放的计数（见 `PlaybackStats`）。 */
  get stats(): PlaybackStats {
    return this.#stats;
  }

  /** 最近一次卡住的诊断（见 `StallReport`）；没卡过是 null。 */
  get stallReport(): StallReport | null {
    return this.#watch.report;
  }

  /** 还卡着的那一段（舞台上的卡住提示，产品设计 §5.1「预览载入与卡住」）；没卡住是 null。 */
  get stall(): StallReport | null {
    return this.#watch.ongoing;
  }

  /** 卡住报出与结束时通知（参数同 `stall`）；订阅时先给一次当前的。 */
  onStall(listener: (stall: StallReport | null) => void): () => void {
    const off = this.#watch.onChange(listener);
    listener(this.#watch.ongoing);
    return off;
  }

  /**
   * 「重试」：只重新载入预览，不动视频。渲染内核还没载入好就不等记下的那一次、重新载入（已经好的照用）；好了就把视频
   * 重新交给它。还在路上的文档、素材字节与本机字体忘掉重新要，卡住诊断从头计时。媒体地址与源元素由界面重新要、重新挂
   * （`preview.tsx`）。
   */
  retry(): void {
    if (this.#disposed) return;
    this.#watch.reset();
    this.#setPictured(false);
    this.#documents?.forgetPending?.();
    this.#assets?.forgetPending?.();
    this.#sentDocuments = null;
    this.#sentSpeech = [];
    // 还在取的字体：忘掉问过的，下一帧照缺的再要（迟到的结果照样注入，只是不再算在「还在取」里）。
    for (const key of [...this.#fontsAsked]) if (this.#fontsLoading.has(key.split('\u0000')[0]!)) this.#fontsAsked.delete(key);
    this.#fontsLoading = new Map();
    this.#dirty = true;
    if (!this.#planner) {
      this.#setStatus({ kind: 'loading' });
      this.#attachPlanner(true);
      return;
    }
    this.#loadVideo();
    this.#refresh();
  }

  /** 当前这一刻的帧计划（舞台点选用它的层几何）；计划器还没好或出错时是上一份或 null。 */
  get plan(): FramePlan | null {
    return this.#plan;
  }

  get captionHits(): readonly CaptionHit[] {
    return this.#captionHits;
  }

  onCaptionHits(listener: (hits: readonly CaptionHit[]) => void): () => void {
    this.#captionListeners.add(listener);
    listener(this.#captionHits);
    return () => this.#captionListeners.delete(listener);
  }

  #setCaptionHits(hits: readonly CaptionHit[]): void {
    const previous = this.#captionHits;
    if (
      previous.length === hits.length && previous.every((hit, i) => {
        const next = hits[i]!;
        return hit.layerId === next.layerId && hit.itemId === next.itemId && hit.documentId === next.documentId && hit.cueId === next.cueId
          && hit.cx === next.cx && hit.cy === next.cy && hit.w === next.w && hit.h === next.h && hit.rotation === next.rotation;
      })
    ) return;
    this.#captionHits = hits;
    for (const listener of this.#captionListeners) listener(hits);
  }

  /** 每求出一份新计划就通知（播放中每帧一次，听的人自己去重）；订阅时有计划先给一次。 */
  onPlan(listener: (plan: FramePlan) => void): () => void {
    this.#planListeners.add(listener);
    if (this.#plan) listener(this.#plan);
    return () => this.#planListeners.delete(listener);
  }

  /** 定位（暂停时由播放头驱动；播放中拖动播放头也走这里）。 */
  seek(seconds: number): void {
    this.#time = Math.max(0, seconds);
    if (this.#playing) {
      this.#clockStart = performance.now();
      this.#timeStart = this.#time;
    } else {
      // 停着定位：先不等定位落地，一阵没再定位才画精确的那一帧（已经是了就不再画）。
      const dragging = this.#scrubTimer !== null;
      this.#endScrub();
      this.#dragging = dragging;
      this.#scrubTimer = setTimeout(() => {
        this.#endScrub();
        if (!this.#exact) this.#requestPaint();
      }, SCRUB_SETTLE_MS);
    }
    this.#exact = false;
    this.#refresh();
  }

  play(): void {
    if (this.#playing || !this.#video) return;
    const end = durationSeconds(this.#video.sequence);
    if (end <= 0) return;
    if (this.#time >= end - 1e-3) this.#time = 0;
    this.#playing = true;
    this.#clockStart = performance.now();
    this.#timeStart = this.#time;
    this.#cancelPaint();
    this.#endScrub();
    this.#exact = false;
    this.#stats = emptyStats();
    const step = () => {
      if (!this.#playing || !this.#video) return;
      const started = performance.now();
      const now = this.#timeStart + ((performance.now() - this.#clockStart) / 1000) * this.#rate;
      const limit = durationSeconds(this.#video.sequence);
      if (now >= limit) {
        this.#time = limit;
        this.pause();
        this.#callbacks.onTime(limit);
        this.#callbacks.onEnded();
        return;
      }
      this.#time = now;
      this.#sync();
      const plan = this.#plan;
      const painted = this.#painted;
      // 视频帧没变、也没有别的东西变：画布上已经是这一帧（显示器刷新比视频帧率高时，一帧只画一次）。
      if (!this.#dirty && plan && painted && plan.frame === painted.frame && plan.sequenceRevision === painted.revision)
        this.#stats.repeated++;
      else if (!this.#paint()) this.#stats.held++;
      this.#callbacks.onTime(now);
      this.#stats.ticks++;
      sample(this.#stats.tickMs, performance.now() - started);
      this.#tick = requestAnimationFrame(tick);
    };
    // 这一帧里抛了意外的错（不是 PlanFailure）：打出来、接着排下一帧，不让播放停在一张黑屏上。
    const tick = () => {
      try {
        step();
      } catch (error) {
        this.#watch.noteError('播放', error); // i18n-ignore: 开发日志
        if (this.#playing) this.#tick = requestAnimationFrame(tick);
      }
    };
    this.#sync();
    this.#tick = requestAnimationFrame(tick);
  }

  pause(): void {
    this.#playing = false;
    cancelAnimationFrame(this.#tick);
    for (const element of this.#elements.values()) if (!(element instanceof HTMLImageElement)) element.pause();
    // 停下之后逐帧对准，画出停住的那一帧。
    this.#refresh();
  }

  dispose(): void {
    this.#disposed = true;
    this.#watch.stop();
    this.pause();
    this.#cancelPaint();
    this.#endScrub();
    for (const unwatch of this.#unwatch ?? []) unwatch();
    this.#unwatch = null;
    for (const element of this.#elements.values()) this.#listen(element, false);
    this.#elements.clear();
    this.#statusListeners.clear();
    this.#pictureListeners.clear();
    this.#monitorListeners.clear();
  }

  #setStatus(status: PreviewStatus): void {
    if (JSON.stringify(status) === JSON.stringify(this.#status)) return;
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }

  #setPictured(pictured: boolean): void {
    if (pictured === this.#pictured) return;
    this.#pictured = pictured;
    for (const listener of this.#pictureListeners) listener(pictured);
  }

  #loadVideo(): void {
    if (!this.#planner || !this.#video) return;
    // 字幕档位先停掉不该露的字幕；转录中的临时字幕不分原文译文，只有 `off` 时不叠。
    const video = this.#captionMode
      ? { ...this.#video, sequence: captionView(this.#video.sequence, this.#documentRecords, this.#captionMode) }
      : this.#video;
    try {
      // 转录中的临时字幕叠一层上去；内核不收这一层时（不该发生）丢掉它照原样送，不让它拖垮整个预览。
      if (this.#liveDocuments && this.#captionMode !== 'off') {
        try {
          this.#planner.setVideo({ ...video, sequence: withLiveCaption(video.sequence) });
          this.#videoError = null;
          return;
        } catch (error) {
          if (!(error instanceof PlanFailure)) throw error;
          this.#liveCues.clear();
          this.#liveDocuments = null;
        }
      }
      this.#planner.setVideo(video);
      this.#videoError = null;
    } catch (error) {
      if (!(error instanceof PlanFailure)) throw error;
      this.#videoError = error.message;
    }
  }

  /** 按当前时刻重新对一次元素并安排重画。 */
  #refresh(): void {
    if (this.#disposed) return;
    this.#sync();
    this.#requestPaint();
  }

  /** 问计划器这一刻的计划，让媒体元素对上它。 */
  #sync(): void {
    const planner = this.#planner;
    if (!planner || !this.#video) return;
    if (this.#videoError) {
      this.#setStatus({ kind: 'error', message: this.#videoError });
      return;
    }
    let plan: FramePlan;
    try {
      this.#sendSpeech(planner);
      plan = planner.planAt(this.#time);
    } catch (error) {
      if (!(error instanceof PlanFailure)) throw error;
      this.#setStatus({ kind: 'error', message: error.message });
      return;
    }
    this.#setStatus(this.#ready());
    if (this.#plan?.sequenceId !== plan.sequenceId || this.#plan?.sequenceRevision !== plan.sequenceRevision || this.#plan?.frame !== plan.frame)
      this.#setCaptionHits([]);
    this.#plan = plan;
    for (const listener of this.#planListeners) listener(plan);

    // 视频层与自带的声音（轨道隐藏时只有声音）：视频实例，或带预渲染替身的合成。素材取计划里带的那个。
    // 转场另一侧的层（在自己的区间之外，取 handles 里的画面）也要一个元素，静音。
    const videos = new Map<Id, { asset: VersionRef; target: Target }>();
    for (const layer of drawnLayers(plan)) {
      if (layer.kind !== 'video') continue;
      const target = { seconds: layer.sourceSeconds ?? 0, rate: layer.sourceRate ?? 1, muted: true, volume: 1 };
      videos.set(layer.itemId, { asset: layer.asset, target });
    }
    const wanted = new Map<MediaKey, Target>();
    for (const voice of plan.voices) {
      const target = { seconds: voice.sourceSeconds, rate: voice.sourceRate, muted: false, volume: dbToVolume(voice.gainDb) };
      if (voice.source === 'audio') wanted.set(audioKey(voice.itemId), target);
      else videos.set(voice.itemId, { asset: voice.asset, target });
    }
    this.#assignSlots(videos);
    for (const [itemId, { target }] of videos) {
      const key = this.#slotOf.get(itemId);
      if (key) wanted.set(key, target);
    }

    for (const [key, element] of this.#elements) {
      if (element instanceof HTMLImageElement) continue;
      const target = wanted.get(key);
      if (target) this.#drive(element, target);
      else if (!element.paused) element.pause();
    }
  }

  /** 给这一刻出视频的实例分元素：还在画面上的留在原槽，新来的挑离目标时刻最近的空槽（少定位一次）。 */
  #assignSlots(videos: Map<Id, { asset: VersionRef; target: Target }>): void {
    const slotCount = (asset: VersionRef) => this.#slotCounts.get(`${asset.id}:${asset.revision}`) ?? 1;
    const used = new Set<MediaKey>();
    for (const [itemId, key] of this.#slotOf) {
      const video = videos.get(itemId);
      // 换了素材版本、或者编辑之后槽变少了，原来的槽就不算数。
      const valid = video && Array.from({ length: slotCount(video.asset) }, (_, slot) => videoKey(video.asset, slot)).includes(key);
      if (valid) used.add(key);
      else this.#slotOf.delete(itemId);
    }
    for (const [itemId, { asset, target }] of videos) {
      if (this.#slotOf.has(itemId)) continue;
      const count = slotCount(asset);
      let best: MediaKey | null = null;
      let bestDistance = Infinity;
      for (let slot = 0; slot < count; slot++) {
        const key = videoKey(asset, slot);
        if (used.has(key)) continue;
        const element = this.#elements.get(key);
        const distance = element instanceof HTMLMediaElement ? Math.abs(element.currentTime - target.seconds) : Infinity;
        if (best === null || distance < bestDistance) {
          best = key;
          bestDistance = distance;
        }
      }
      if (best === null) continue;
      used.add(best);
      this.#slotOf.set(itemId, best);
    }
  }

  #drive(element: HTMLMediaElement, target: Target): void {
    element.muted = target.muted || this.#monitor.muted;
    element.volume = target.volume * this.#monitor.volume;
    // 元数据到了才能定位（loadedmetadata 时再来）；一次定位落地之前不改 currentTime，否则一直到不了 seeked。
    if (element.readyState < HTMLMediaElement.HAVE_METADATA || element.seeking) return;
    const playing = this.#playing && target.rate > 0;
    const seconds = clampToMedia(element, target.seconds);
    const drift = element.currentTime - seconds;
    if (playing) sample(this.#stats.drift, Math.abs(drift));
    if (Math.abs(drift) > (playing ? RESYNC_SECONDS : EXACT_SECONDS)) {
      if (!element.paused && !playing) element.pause();
      if (playing) this.#stats.resyncs++;
      element.currentTime = seconds;
      return;
    }
    if (!playing) {
      if (!element.paused) element.pause();
      return;
    }
    // 偏得不多就调速追上（领先就放慢），不再定位。
    const correction = Math.abs(drift) > 0.02 ? Math.max(-0.5, Math.min(0.5, -drift * 2)) : 0;
    element.playbackRate = Math.max(MIN_RATE, Math.min(MAX_RATE, target.rate * this.#rate * (1 + correction)));
    if (element.paused) void element.play().catch(() => {});
  }

  #sourceOf(layer: MediaLayer): SourceElement | null {
    const key = layer.kind === 'video' ? this.#slotOf.get(layer.itemId) : imageKey(layer.asset);
    const element = key ? this.#elements.get(key) : undefined;
    return element instanceof HTMLVideoElement || element instanceof HTMLImageElement ? element : null;
  }

  /**
   * 一层现在能不能画：`pending` 是还在载入或定位（画面会来，先留着上一帧）；`absent` 是没有元素或载入失败，
   * 不等它。定位时 readyState 会掉到 HAVE_METADATA，那也算 `pending`，否则每次跳转都先闪一帧空的。
   */
  #readiness(layer: MediaLayer): Readiness {
    if (this.#kernelDecoded(layer)) {
      // SVG 图片在 WASM 里按输出的长边光栅（贴纸的换色也在那里做），GIF 在 WASM 里解成动图按时刻取帧：等的是素材字节，不是图片元素。
      const state = this.#assets?.get(layer.asset, BYTES);
      return state?.state === 'ready' ? 'ready' : state?.state === 'loading' ? 'pending' : 'absent';
    }
    const element = this.#sourceOf(layer);
    if (!element) return 'absent';
    if (element instanceof HTMLImageElement) {
      if (!element.complete) return 'pending';
      return element.naturalWidth > 0 ? 'ready' : 'absent';
    }
    if (element.error) return 'absent';
    if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || element.seeking) return 'pending';
    const seconds = clampToMedia(element, layer.sourceSeconds ?? 0);
    const tolerance = this.#playing && (layer.sourceRate ?? 1) > 0 ? RESYNC_SECONDS : EXACT_SECONDS;
    return Math.abs(element.currentTime - seconds) <= tolerance ? 'ready' : 'pending';
  }

  /**
   * 画当前计划。有层还在定位时先留着上一帧，等不及了再画（返回 false 表示这次没画）。画面按画布像素（序列画布乘
   * `scale`）在 WASM 里画好，整帧放到画布上；画不出来的东西（跳过的层、效果、按硬切的转场）与内核的提示报出来，
   * 还在取的文档与素材不算。
   */
  #paint(): boolean {
    const plan = this.#plan;
    const context = this.#context;
    const planner = this.#planner;
    if (!plan || !context || !planner) return true;
    const layers = drawnLayers(plan);
    const states = new Map(layers.filter(isMediaLayer).map((layer) => [layer.itemId, this.#readiness(layer)]));
    const scrubbing = !this.#playing && this.#scrubTimer !== null;
    // 拖动中还在定位的层：元素读过画面就先用那张，不等。
    const stale = new Map<Id, ImageData>();
    for (const layer of scrubbing ? layers.filter(isMediaLayer) : []) {
      const element = states.get(layer.itemId) === 'pending' && !this.#kernelDecoded(layer) ? this.#sourceOf(layer) : null;
      const picture = element ? this.#lastPictures.get(element) : undefined;
      if (picture) stale.set(layer.itemId, picture);
    }
    const waiting = [...states].some(([itemId, state]) => state === 'pending' && !stale.has(itemId));
    if (waiting) {
      const now = performance.now();
      this.#holdSince ??= now;
      if (now - this.#holdSince < (this.#playing ? HOLD_PLAYING_MS : HOLD_PAUSED_MS)) return false;
    }
    this.#holdSince = null;
    this.#dirty = false;
    // 播放中、拖动中与先用旧画面时降分辨率画（内容不变）；停住时画原尺寸，与导出同一帧。
    const quality = this.#playing || (scrubbing && (this.#dragging || stale.size > 0)) ? 'playback' : 'exact';
    const { width, height } = paintSize(plan.canvas, this.#scale, quality);
    const pending = new Set<Id>();
    const notes: string[] = [];
    let rendered: RenderedFrame;
    try {
      this.#sendDocuments(planner, layers, pending);
      // 暂停时转写取到了只叫重画、不重新对元素：在这里送上，这一帧就按转写画声波。
      if (this.#speechLoading) this.#sendSpeech(planner);
      this.#sendAssets(planner, layers, pending);
      const start = performance.now();
      this.#sendPictures(planner, layers, states, stale, width, height);
      const uploaded = performance.now();
      rendered = planner.render(this.#time, width, height);
      if (this.#playing) {
        sample(this.#stats.uploadMs, uploaded - start);
        sample(this.#stats.renderMs, performance.now() - uploaded);
      }
      // 这一帧的声波还是占位的样子：频谱到了就送进去，再画一次（播放中下一帧自然会画）。
      if (this.#sendSpectra(planner, rendered.spectra, pending, notes)) this.#requestPaint();
      this.#requestFonts(planner, rendered);
    } catch (error) {
      if (!(error instanceof PlanFailure)) throw error;
      this.#setStatus({ kind: 'error', message: error.message });
      return true;
    }
    const { canvas } = context;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.putImageData(new ImageData(planner.frame(), width, height), 0, 0);
    // 临时字幕不是视频里的实例：不给点选；内核对它的提示（跳过、警告）与还在取的层一样不报（记进 `pending`）。
    this.#setCaptionHits((rendered.captionHits ?? []).filter((hit) => hit.itemId !== LIVE_CAPTION_ITEM_ID));
    pending.add(LIVE_CAPTION_ITEM_ID);
    this.#painted = { revision: plan.sequenceRevision, frame: plan.frame };
    this.#exact = quality === 'exact' && [...states.values()].every((state) => state === 'ready');
    // 画面出来了：没有还在来的媒体。载入失败的元素与取不到的素材字节不再等（这一帧照画，跳过它），只有还没有元素的在来。
    const coming = layers.filter(isMediaLayer).some((layer) => {
      const state = states.get(layer.itemId);
      return state === 'pending' || (state === 'absent' && !this.#kernelDecoded(layer) && this.#sourceOf(layer) === null);
    });
    if (!coming) this.#setPictured(true);
    if (this.#playing) {
      this.#stats.presented++;
      sample(this.#stats.frames, plan.frame);
    }
    this.#stats.size = { width, height };
    // 还在取本机字体的族不报缺字体（取不到时下一帧照报，与导出一致）。
    // i18n-ignore: 匹配渲染内核报来的缺字体提示原文
    const loadingFonts = [...this.#fontsLoading.keys()].map((family) => `字体 ${JSON.stringify(family)} `);
    const problems = [
      ...new Set([
        ...rendered.skipped.filter((item) => !pending.has(item.itemId)).map((item) => item.message),
        // 内核的提示以「实例 ID：」开头；还在取频谱的声波不报。
        ...rendered.warnings
          .filter((warning) => !pending.has(warning.detail.split('：')[0]!)) // i18n-ignore: 内核提示的「实例 ID：」分隔符
          .filter((warning) => !loadingFonts.some((prefix) => warning.detail.includes(prefix)))
          // 转写还在取：先别说没有转写。
          .filter((warning) => !(this.#speechLoading && SPEAKER_NOTE.test(warning.detail)))
          .map((warning) => warning.detail),
        ...notes,
      ]),
    ];
    if (problems.join('\n') !== this.#problems.join('\n')) {
      this.#problems = problems;
      if (this.#status.kind === 'ready') this.#setStatus(this.#ready());
    }
    return true;
  }

  /**
   * 本机字体（架构设计 §9.1）：报过缺的族里排字点了名的 face（族名、字重、斜体）向宿主要（与导出冻结的同一份解析与
   * 抽法，只取那一个 face），到了注入计划器再画一次。每个 face 只要一次；取不到的照回退字体画，缺字体的提示照报。
   */
  #requestFonts(planner: RenderPlanner, rendered: RenderedFrame): void {
    for (const family of rendered.fonts ?? []) this.#fontsMissing.add(family);
    const source = this.#fonts;
    const fresh = (rendered.faces ?? []).filter((face) => {
      const family = face.family.trim();
      return family.length > 0 && family.length <= 200 && this.#fontsMissing.has(face.family) && !this.#fontsAsked.has(fontKey(face));
    });
    if (!source || fresh.length === 0) return;
    // 记在这一刻的表上：重试换了新表之后，这一批迟到的结果不动新表的计数。
    const counts = this.#fontsLoading;
    const loading = (face: FontFaceQuery, step: number) => {
      const count = (counts.get(face.family) ?? 0) + step;
      if (count > 0) counts.set(face.family, count);
      else counts.delete(face.family);
    };
    for (const face of fresh) {
      this.#fontsAsked.add(fontKey(face));
      loading(face, 1);
    }
    const inject = (faces: LoadedFace[]) => {
      if (this.#disposed) return;
      for (const { font, bytes } of faces) planner.addLocalFont(font, bytes);
    };
    source
      // 同一批里先到的（本机的、已经下载好的）先注入、先重画，不等还在下载的。
      .load(
        fresh.map((face) => ({ ...face, family: face.family.trim() })),
        (faces) => {
          inject(faces);
          if (!this.#disposed) this.#requestPaint();
        },
      )
      .then(inject)
      // 取不到（或计划器正在重新载入）：照回退字体画。
      .catch(() => {})
      .finally(() => {
        for (const face of fresh) loading(face, -1);
        if (!this.#disposed) this.#requestPaint();
      });
  }

  /**
   * 字幕层要读的文档（字幕文档与样式文档）：取到的送正文，还没取到的先去取、送 `null`，用到它的层记进 `pending`。
   * 正文对象没变就不重送。
   */
  #sendDocuments(planner: RenderPlanner, layers: VisualLayer[], pending: Set<Id>): void {
    const wanted = new Map<Id, Id[]>();
    for (const layer of layers) {
      if (layer.kind !== 'caption') continue;
      for (const id of [layer.content.documentId, layer.content.styleDocumentId]) {
        if (id) wanted.set(id, [...(wanted.get(id) ?? []), layer.itemId]);
      }
    }
    const documents: FrozenDocument[] = [];
    for (const [documentId, itemIds] of wanted) {
      // 临时字幕层的文档在界面里，不向 Runtime 取。
      const live = this.#liveDocuments?.find((document) => document.documentId === documentId);
      if (live) {
        documents.push(live);
        continue;
      }
      const record = this.#documentRecords[documentId];
      let body: unknown = null;
      if (record && this.#documents) {
        body = this.#documents.peek(documentId, record.currentRevision);
        if (body === undefined) {
          this.#documents.load(documentId, record.currentRevision);
          for (const itemId of itemIds) pending.add(itemId);
          body = null;
        }
      }
      const parent = record?.sourceDocumentId ? this.#documentRecords[record.sourceDocumentId] : undefined;
      const schema = isRecord(body) && typeof body.schema === 'string' ? body.schema : undefined;
      documents.push({
        documentId,
        ...(record ? { kind: record.kind } : {}),
        ...(schema ? { schema } : {}),
        lineKind: parent?.kind === 'translation' ? 'translation' : 'original',
        ...(record?.sourceDocumentId ? { sourceDocumentId: record.sourceDocumentId } : {}),
        ...(record?.sourceAssetId ? { sourceAssetId: record.sourceAssetId } : {}),
        body,
      });
    }
    const sent = this.#sentDocuments;
    const same =
      sent?.length === documents.length &&
      documents.every((document, index) => {
        const previous = sent[index]!;
        return (
          previous.documentId === document.documentId &&
          previous.body === document.body &&
          previous.lineKind === document.lineKind &&
          previous.sourceDocumentId === document.sourceDocumentId &&
          previous.sourceAssetId === document.sourceAssetId
        );
      });
    if (same) return;
    planner.setDocuments(documents);
    this.#sentDocuments = documents;
  }

  /**
   * 转写：按文稿触发的闪避与写了 `speaker` 的声波要视频里的每份转写，WASM 投成有效词流（按说话人分开的区间给声波）；
   * 字幕要它的字幕文档派生自的那份转写（逐词动画与强调按转写里的词推进）。都与导出同一份。已经取到的送进去，还没取到的
   * 先去取，取到之后下一次对元素时送上。正文对象没变就不重送。
   */
  #sendSpeech(planner: RenderPlanner): void {
    const sequence = this.#video?.sequence;
    const all =
      (sequence?.ducking?.some((rule) => rule.enabled && rule.trigger.kind === 'speech') ?? false) ||
      (sequence?.items.some((item) => item.type === 'visualizer' && !!item.visualizer.speaker) ?? false);
    const forCaptions = new Set<Id>();
    for (const item of sequence?.items ?? []) {
      if (item.type !== 'caption' || !item.enabled) continue;
      const parent = this.#documentRecords[item.documentId]?.sourceDocumentId;
      if (parent && this.#documentRecords[parent]?.kind === 'speech') forCaptions.add(parent);
    }
    const transcripts: SpeechTranscript[] = [];
    let loading = false;
    if ((all || forCaptions.size > 0) && this.#documents) {
      for (const record of Object.values(this.#documentRecords)) {
        if (record.kind !== 'speech' || (!all && !forCaptions.has(record.id))) continue;
        const body = this.#documents.peek(record.id, record.currentRevision);
        if (body === undefined) {
          this.#documents.load(record.id, record.currentRevision);
          loading = true;
          continue;
        }
        transcripts.push({ documentId: record.id, ...(record.sourceAssetId ? { sourceAssetId: record.sourceAssetId } : {}), body });
      }
    }
    this.#speechLoading = loading;
    const sent = this.#sentSpeech;
    const same =
      sent.length === transcripts.length &&
      transcripts.every((transcript, index) => {
        const previous = sent[index]!;
        return (
          previous.documentId === transcript.documentId &&
          previous.sourceAssetId === transcript.sourceAssetId &&
          previous.body === transcript.body
        );
      });
    if (same) return;
    planner.setSpeech(transcripts);
    this.#sentSpeech = transcripts;
  }

  /** Lottie 层与 SVG、GIF 图片层的素材字节：取到的送进去（同一份只送一次），还在取的层记进 `pending`。 */
  #sendAssets(planner: RenderPlanner, layers: VisualLayer[], pending: Set<Id>): void {
    for (const layer of layers) {
      let asset: unknown;
      if (layer.kind === 'generator' && layer.content.generator === 'baocut.lottie') asset = layer.content.parameters.asset;
      else if (isMediaLayer(layer) && this.#kernelDecoded(layer)) asset = layer.asset;
      else continue;
      if (!isVersionRef(asset) || !this.#assets) continue;
      const state = this.#assets.get(asset, BYTES);
      if (state.state === 'ready') planner.setAsset(asset, state.value);
      else if (state.state === 'loading') pending.add(layer.itemId);
    }
  }

  /**
   * 声波要的素材频谱（计划器报缺的那些）：取到的送进去（返回 true，要再画一次），还在算的实例记进 `pending`。
   * 太大的素材预览不分析，报一条提示进 `notes`；解不出声音的由内核的提示报出来。
   */
  #sendSpectra(planner: RenderPlanner, missing: readonly MissingSpectrum[], pending: Set<Id>, notes: string[]): boolean {
    if (!this.#assets) return false;
    let sent = false;
    for (const { itemId, asset } of missing) {
      const size = this.#video?.assets[asset.id]?.revisions[asset.revision]?.byteLength ?? 0;
      if (size > SPECTRUM_MAX_BYTES) {
        notes.push(E.spectrumTooLarge(itemId, asset.id, SPECTRUM_MAX_BYTES / 1024 / 1024));
        continue;
      }
      this.#spectrum ??= spectrumDecoder(planner);
      const state = this.#assets.get(asset, this.#spectrum);
      if (state.state === 'ready') sent = planner.setAudioSpectrum(asset, state.value) || sent;
      else if (state.state === 'loading') pending.add(itemId);
    }
    return sent;
  }

  /**
   * 媒体层这一刻的画面：从媒体元素读出像素送进去（每个元素一帧只读一次，同一张图片可以给好几个实例）。读出来的
   * 画面不比输出大（按铺满输出缩小），源区域在 WASM 那边按比例取，所以别的尺寸下读的画面也能用。`stale` 是拖动中
   * 先用元素上一张画面的层。没有画面的层不送，由 WASM 跳过。
   */
  #sendPictures(
    planner: RenderPlanner,
    layers: VisualLayer[],
    states: Map<Id, Readiness>,
    stale: Map<Id, ImageData>,
    width: number,
    height: number,
  ): void {
    planner.clearPictures();
    const read = new Map<SourceElement, ImageData | null>();
    for (const layer of layers) {
      if (!isMediaLayer(layer) || this.#kernelDecoded(layer)) continue;
      let pixels = stale.get(layer.itemId) ?? null;
      const element = states.get(layer.itemId) === 'ready' ? this.#sourceOf(layer) : null;
      if (element) {
        if (!read.has(element)) {
          const picture = this.#readPixels(element, width, height);
          if (picture) this.#lastPictures.set(element, picture);
          read.set(element, picture);
        }
        pixels = read.get(element) ?? null;
      }
      if (pixels) planner.setPicture(layer.itemId, pixels.data, pixels.width, pixels.height);
    }
  }

  /** 图片层的素材是 SVG 或 GIF（按素材版本的媒体类型）：画面由 WASM 从字节光栅或解码（与导出同一份），不读图片元素的像素。 */
  #kernelDecoded(layer: MediaLayer): boolean {
    if (layer.kind !== 'image') return false;
    const mediaType = this.#video?.assets[layer.asset.id]?.revisions[layer.asset.revision]?.mediaType;
    return mediaType === 'image/svg+xml' || mediaType === 'image/gif';
  }

  #readPixels(element: SourceElement, width: number, height: number): ImageData | null {
    const [sourceWidth, sourceHeight] =
      element instanceof HTMLVideoElement ? [element.videoWidth, element.videoHeight] : [element.naturalWidth, element.naturalHeight];
    if (!(sourceWidth > 0 && sourceHeight > 0)) return null;
    const fit = Math.min(1, Math.max(width / sourceWidth, height / sourceHeight));
    const w = Math.max(1, Math.round(sourceWidth * fit));
    const h = Math.max(1, Math.round(sourceHeight * fit));
    this.#scratch ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const scratch = this.#scratch;
    if (!scratch) return null;
    if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
      scratch.canvas.width = w;
      scratch.canvas.height = h;
    }
    scratch.clearRect(0, 0, w, h);
    scratch.drawImage(element, 0, 0, w, h);
    return scratch.getImageData(0, 0, w, h);
  }

  #ready(): PreviewStatus {
    return this.#problems.length > 0 ? { kind: 'ready', problems: this.#problems } : { kind: 'ready' };
  }

  /** 媒体元素的状态；还没有元素、是因为 Runtime 在准备兼容副本时，说在等副本、带上进度。 */
  #probe(element: Parameters<typeof probeElement>[0], asset: VersionRef): Pick<MediaProbe, 'wait' | 'element' | 'progress'> {
    const probe = probeElement(element);
    const progress = probe.wait === 'no-element' ? this.#preparing?.(asset) : undefined;
    return progress === undefined ? probe : { ...probe, wait: 'preparing', progress };
  }

  /** 给卡住诊断的快照：卡在哪一步、哪些媒体层与声音还没好、哪些文档与字体还在取。 */
  #snapshot(): PreviewSnapshot {
    const plan = this.#plan;
    const painted = this.#painted;
    const media: MediaProbe[] = [];
    const documents = new Set<Id>();
    if (plan) {
      for (const layer of drawnLayers(plan)) {
        if (layer.kind === 'caption') {
          for (const id of [layer.content.documentId, layer.content.styleDocumentId]) {
            const record = id ? this.#documentRecords[id] : undefined;
            if (id && record && this.#documents?.peek(id, record.currentRevision) === undefined) documents.add(id);
          }
        }
        if (!isMediaLayer(layer) || this.#readiness(layer) === 'ready') continue;
        const wantedSeconds = layer.kind === 'video' ? (layer.sourceSeconds ?? 0) : null;
        if (this.#kernelDecoded(layer)) {
          const state = this.#assets?.get(layer.asset, BYTES).state;
          media.push({
            itemId: layer.itemId,
            assetId: layer.asset.id,
            kind: layer.kind,
            wait: state === 'loading' ? 'bytes-loading' : 'bytes-missing',
            wantedSeconds,
            element: null,
          });
        } else media.push({ itemId: layer.itemId, assetId: layer.asset.id, kind: layer.kind, wantedSeconds, ...this.#probe(this.#sourceOf(layer), layer.asset) });
      }
      // 只出声的（音频实例，或轨道隐藏的视频）：元素没有这一刻的数据就没有声音。
      for (const voice of plan.voices) {
        if (media.some((probe) => probe.itemId === voice.itemId)) continue;
        const key = voice.source === 'audio' ? audioKey(voice.itemId) : this.#slotOf.get(voice.itemId);
        const probe = this.#probe(key ? (this.#elements.get(key) as HTMLMediaElement | undefined) : null, voice.asset);
        if (probe.wait === 'position') continue;
        media.push({
          itemId: voice.itemId,
          assetId: voice.asset.id,
          kind: voice.source === 'audio' ? 'audio' : 'video',
          wantedSeconds: voice.sourceSeconds,
          ...probe,
        });
      }
    }
    return {
      status: this.#status.kind,
      planner: this.#planner ? 'ready' : 'loading',
      video: this.#video !== null,
      videoError: this.#videoError,
      plan: plan !== null,
      canvas: this.#context !== null,
      playing: this.#playing,
      painted,
      paintWanted:
        this.#playing ||
        this.#dirty ||
        this.#paintTimer !== null ||
        (plan !== null && (painted?.frame !== plan.frame || painted.revision !== plan.sequenceRevision)),
      media,
      documents: [...documents],
      fonts: [...this.#fontsLoading.keys()],
    };
  }

  /**
   * 暂停时的重画：同一轮里的多次请求合成一次；还在等定位就过一会儿再试（媒体事件也会再叫）。
   * 不用 requestAnimationFrame：窗口被挡住时它不跑，而停住的那一帧应该先画好。
   */
  #requestPaint(delay = 0): void {
    if (this.#disposed) return;
    // 播放中下一个 tick 自然会画：记下要重画，同一帧也不跳过。
    if (this.#playing) {
      this.#dirty = true;
      return;
    }
    if (this.#paintTimer) {
      if (delay > 0) return;
      clearTimeout(this.#paintTimer);
    }
    this.#paintTimer = setTimeout(() => {
      this.#paintTimer = null;
      try {
        if (!this.#playing && !this.#paint()) this.#requestPaint(HOLD_PAUSED_MS);
      } catch (error) {
        // 意外的错：打出来，下一次请求照常画（不在这里重试，免得每秒刷一遍同一个错）。
        this.#watch.noteError('重画', error); // i18n-ignore: 开发日志
      }
    }, delay);
  }

  #cancelPaint(): void {
    if (this.#paintTimer) clearTimeout(this.#paintTimer);
    this.#paintTimer = null;
  }

  #endScrub(): void {
    if (this.#scrubTimer) clearTimeout(this.#scrubTimer);
    this.#scrubTimer = null;
    this.#dragging = false;
  }

  #listen(element: SourceElement | HTMLAudioElement, on: boolean): void {
    const method = on ? 'addEventListener' : 'removeEventListener';
    if (element instanceof HTMLImageElement) {
      element[method]('load', this.#onMediaEvent);
      element[method]('error', this.#onMediaEvent);
      return;
    }
    for (const type of ['loadedmetadata', 'loadeddata', 'seeked', 'error'] as const) element[method](type, this.#onMediaEvent);
  }

  /** 元数据到了可以定位、定位落地了、有画面了：按最新的计划再对一次（旧的定位结果不会画在新的上面）。 */
  readonly #onMediaEvent = () => {
    try {
      this.#refresh();
    } catch (error) {
      this.#watch.noteError('处理媒体事件', error); // i18n-ignore: 开发日志
    }
  };
}

/** 这一帧要画的层：计划里的层，加上转场另一侧的层。 */
/** 本机字体 face 的键：族名、字重与斜体。 */
function fontKey(face: FontFaceQuery): string {
  return `${face.family}\u0000${face.weight}\u0000${face.italic}`;
}

function drawnLayers(plan: FramePlan): VisualLayer[] {
  return plan.layers.flatMap((layer) => (layer.transition?.partner ? [layer, layer.transition.partner] : [layer]));
}

/** 源时刻超出素材时长时停在最后：否则每次定位都落不到目标，会一直重试。 */
function clampToMedia(element: HTMLMediaElement, seconds: number): number {
  return Number.isFinite(element.duration) ? Math.min(seconds, element.duration) : seconds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVersionRef(value: unknown): value is VersionRef {
  return isRecord(value) && typeof value.id === 'string' && typeof value.revision === 'string';
}

function dbToVolume(db: number): number {
  return Math.max(0, Math.min(1, 10 ** (db / 20)));
}
