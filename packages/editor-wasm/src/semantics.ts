/**
 * `bindings/editor-wasm` 的 TS 一侧（架构设计 §1.4、§13.1、§13.6）：界面与 Node 要的领域规则经这里调 Rust 的那一份，TS 不另写。
 * - 转写正文的句子与原文指纹（字幕与翻译核心）：翻译流程、译文核对、配音判过期、内容索引（Node）与界面的逐句对照（浏览器）；
 * - 舞台的框（`render-graph` 的 `item_box`）：`place` 与画布像素框互换、种类的缺省落位，与帧计划画层同一个实现；
 * - 引擎校验用的取值区间与缺省值（效果、闪避、音量、关键帧、动画）：界面的数字框按它们封顶；
 * - 已有转写的识别说话人（架构设计 §6.6）：声纹区分的结果做成提案、确认后应用（字幕与翻译核心的说话人应用）；
 * - 来源自带章节（架构设计 §3.5、§7.9）：平台的 `chapters[]`、简介里的时间戳大纲或显式大纲，吸附到转写的段落、句子起点。
 *
 * 实例化是同步的（WASM 不到 1 MB，浏览器主线程同步编译的上限是 8 MB），所以调用方可以在渲染里直接调。
 * 载入字节的方式按环境分开：`node.ts` 从文件读，`browser.ts` 由 Vite 内联；两边导出同一组函数。
 */

export const SENTENCE_DERIVATION = 'speech-doc/sentences';

/** 一句原文。`start` / `end` 是首词起点与末词终点，转写正文 `timescale` 下的整数刻度。 */
export interface SourceSentence {
  /** `s-<首词 ID>`。 */
  id: string;
  /** 句内可见的词，按词序；隐藏的词不在里面。 */
  wordIds: string[];
  text: string;
  /** 核心的内容指纹：`<词数>:<首词 ID>:<末词 ID>:<FNV-1a 的 36 进制>`。 */
  fingerprint: string;
  /** 首词的说话人；没有时省略。不进指纹。 */
  speaker?: string;
  start: number;
  end: number;
}

/** 一份转写的全部句子。 */
export interface SpeechSentences {
  derivation: typeof SENTENCE_DERIVATION;
  /** 转写正文的 `timescale`（没有时按 1 000 000）。 */
  timescale: number;
  /** 派生规则与全部句子的 ID、指纹的摘要（`sourceBasis.editViewHash`）。 */
  editViewHash: string;
  /**
   * 全文的内容指纹（核心的 `fingerprint`，算全部的词、含隐藏的）：与正文 `stages.asr` 同一种写法，二者不同说明转写之后
   * 有人改过原文（视频格式规范 §5.5）。
   */
  contentFingerprint: string;
  sentences: SourceSentence[];
}

/** 推框要看的实例字段（多给的字段不管，新建之前的草稿层也行）。 */
export interface StageItem {
  type: string;
  place?: object;
  mode?: string;
  shape?: object;
  sticker?: object;
  crop?: object;
}

/** 实例引用的素材（合成是预渲染）里推框要看的部分：种类与那个版本的视频信息。 */
export interface StageAsset {
  kind: string;
  video?: { displayWidth: number; displayHeight: number; pixelAspectRatio: { num: number; den: number } };
}

export interface StageCanvas {
  width: number;
  height: number;
}

/** 框：中心、未旋转的宽高（画布像素，左上原点）、绕中心顺时针的角度（度）。 */
export interface StagePose {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

export interface StageBox extends StagePose {
  flipX: boolean;
  flipY: boolean;
  /** 铺满画布：框不看 `place` 的位置与大小，只能转。 */
  fullscreen: boolean;
}

/** 写回 `place` 的字段：只有取整后与此刻不同的才有（百分比与角度一位小数，`scaleY` 三位）。 */
export interface PlaceChange {
  x?: number;
  y?: number;
  w?: number;
  scaleY?: number;
  rot?: number;
}

/** 种类的缺省落位：中心（画幅百分比）与框宽（宽度基准的百分比）。 */
export interface PlaceDefault {
  x: number;
  y: number;
  w: number;
}

/** 含两端的区间 `[下限, 上限]`。 */
export type Range = readonly [number, number];

/** 引擎校验用的取值区间与缺省值（滑杆的常用范围、步长与读数倍率是界面的设计，不在这里）。 */
export interface EngineRanges {
  fx: {
    /** `grayscale`、`sharpen`、`noise`、`vignette`、`effectIntensity`。 */
    amount: Range;
    /** `brightness`、`contrast`、`exposure`、`hue`、`saturation`。 */
    adjust: Range;
    temperature: Range;
    /** 540 短边下的像素。 */
    blur: Range;
    shadowBlur: Range;
    shadowOpacity: Range;
    /** 下限不含 0。 */
    strokeWidthMax: number;
  };
  ducking: { depth: Range; time: Range; defaults: { depth: number; attack: number; release: number } };
  /** 实例音量与音量包络（线性倍数）。 */
  volume: Range;
  keyframes: { maxPerProp: number; opacity: Range; volume: Range; percent: Range };
  animation: { duration: Range; period: Range; intensity: Range };
  confetti: {
    maxColors: number;
    /** 12 种单位形（属性页的次序）。 */
    shapes: readonly string[];
    size: Range;
    speed: Range;
    gravity: Range;
    drift: Range;
    spin: Range;
    /** 参考 540 短边下的 px/s²。 */
    wind: Range;
    opacity: Range;
    rate: Range;
    count: Range;
    interval: Range;
    angle: Range;
    spread: Range;
    /** `origin.x` 与 `origin.y`（盒内 %）。 */
    origin: Range;
  };
}

/** 进度条的一款：`bar` 用整个框，`square` 在框里取内切正方形，`frame` 是铺满画幅的边框。 */
export interface ProgressPreset {
  id: string;
  aspect: 'bar' | 'square' | 'frame';
  mainColor: string;
  secondaryColor: string;
  /** 属性页出几个色板（0–2）。 */
  numColors: number;
}

/** 声波的一款：`hasControl` 为 false 的款读时域，dB 窗、平滑与增益对它不起作用。 */
export interface VisualizerPreset {
  id: string;
  aspect: 'free' | 'square';
  mainColor: string;
  secondaryColor: string;
  minDb: number;
  maxDb: number;
  hasControl: boolean;
  numColors: number;
}

/** 彩纸的一款：色板、形状混合与缺省的发射参数。发射器的位置是盒内 %，`angle` 以屏幕坐标计（90 向下、−90 向上）。 */
export interface ConfettiPreset {
  id: string;
  colors: readonly string[];
  shapes: readonly string[];
  /** 改编来源（`库名/部件`）。 */
  sources: readonly string[];
  hasEmitterControl: boolean;
  emit: { mode: 'continuous' | 'burst'; rate: number; count: number; interval: number };
  emitters: readonly { x: number; y: number; angle?: number }[];
  angle: number;
  spread: number;
}

/** 元素的样式目录（目录次序），读渲染用的同一份内置配方。 */
export interface ElementPresets {
  progress: readonly ProgressPreset[];
  visualizer: readonly VisualizerPreset[];
  /** 声波旧 style id → 当前目录的款。 */
  visualizerAliases: Readonly<Record<string, string>>;
  confetti: readonly ConfettiPreset[];
}

/** 一段试听：这位说话人的一句，`start` / `end` 是转写正文 `timescale` 下的刻度。 */
export interface SpeakerClip {
  sentenceId: string;
  start: number;
  end: number;
  text: string;
}

/** 提案里的一位说话人（应用后的样子）。 */
export interface ProposedSpeaker {
  id: string;
  name: string;
  /** 转写里原来没有的说话人。 */
  isNew: boolean;
  words: number;
  /** 这位说话人的词的总时长（秒）。 */
  seconds: number;
  sentences: number;
  clips: SpeakerClip[];
}

/** 识别说话人的提案：应用的一次试算。 */
export interface SpeakerProposal {
  /** 换说话人的词：词 ID → 说话人 ID（只列有变化的）。 */
  wordSpeakers: Record<string, string>;
  /** 按在正文里第一次出现的次序。 */
  speakers: ProposedSpeaker[];
  /** 换了说话人的词数；0 表示与现状相同。 */
  relabeled: number;
  /** 会按新边界重切的译文条数（各语言相加），不重新翻译。 */
  translationsSplit: number;
}

/** 应用的结果：新的转写正文与有变化的译文正文。 */
export interface AppliedSpeakers {
  speech: Record<string, unknown>;
  /** 与输入的译文一一对应：有变化的是整份新正文，没变的为 null。 */
  translations: Array<(Record<string, unknown> & { language: string }) | null>;
  relabeled: number;
  translationsSplit: number;
  sentencesSplit: number;
  /** v3 格式装不下而丢掉的内容（正常为空）。 */
  dropped: string[];
}

/** 来源给的一章（作者的原始时间，源时间秒，未吸附）。简介里解析出的大纲没有 `end`。 */
export interface SourceChapter {
  start: number;
  end?: number;
  title: string;
}

/** 吸附的结果：同一秒窗里恰一个候选（`matched`）、多个同层候选（`ambiguous`，缺省取最近的）、放宽窗里的段落或句起点（`snapped`）、附近没有结构起点（`unanchored`，保留原时间）。 */
export type SourceChapterStatus = 'matched' | 'ambiguous' | 'snapped' | 'unanchored';

/** 转写上可以当章节起点的位置：段落 > 句 > cue > 词。`time` 是源时间秒，`snippet` 是从这里开始的几个词。 */
export interface SourceChapterAnchor {
  tier: 'paragraph' | 'sentence' | 'cue' | 'word';
  id: string;
  time: number;
  snippet: string;
}

/** 一条来源章节的吸附。 */
export interface SourceChapterEntry {
  source: { start: number; title: string };
  status: SourceChapterStatus;
  /** 吸附后的起点（源时间秒）；`unanchored` 时是作者的原时间。 */
  at: number;
  /** 选中的锚；`unanchored` 时没有。 */
  anchor?: SourceChapterAnchor;
  /** 按时间排好的候选；`ambiguous` 时多个。 */
  candidates: SourceChapterAnchor[];
}

/** 清洗后的一章（源时间秒）：丢空标题、按起点排序、同起点去重、首章钳到 0、丢非严格递增；`end` 是下一章的起点，末章是素材时长。 */
export interface SourceChapterRow {
  title: string;
  start: number;
  end: number;
  status: SourceChapterStatus;
}

/** `sourceChapters` 的输入。时间都是素材（源）时间。 */
export interface SourceChaptersInput {
  /** 素材的转写正文（`baocut.speech/1`）；没有转写或 `snap: false` 时省略，所有条目保留原时间。 */
  speech?: unknown;
  /** 素材的来源元数据（`provenance.source`）：先读 `chapters[]`（`start_time | start`、`end_time | end`、`title`），没有再解析 `description`。 */
  source?: unknown;
  /** 显式大纲，优先于 `source`：`[{ at, title }]`（秒），或一段原文（按时间戳大纲解析，至少两条）。 */
  outline?: ReadonlyArray<{ at: number; title: string }> | string;
  /** 素材时长（秒）：末章的终点。 */
  durationSeconds: number;
  /** 默认 true；false 时只解析、不吸附。 */
  snap?: boolean;
}

/** 来源章节的解析与吸附。没有来源章节时 `sourceChapters` 与 `rows` 为空（不报错）。 */
export interface SourceChaptersResult {
  sourceChapters: SourceChapter[];
  entries: SourceChapterEntry[];
  rows: SourceChapterRow[];
  summary: { entries: number; matched: number; ambiguous: number; snapped: number; unanchored: number };
}

/** WASM 拒绝的输入：`INVALID_SPEECH`（转写正文不合格式）、`INVALID_INPUT`（输入不是约定的形状）、`INVALID_PROPOSAL`（说话人提案与正文对不上）。 */
export class EditorWasmError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EditorWasmError';
    this.code = code;
  }
}

/** WASM 还没有构建（先运行 `npm run build:wasm`）。带 `code`：流程的一步因它失败时，错误码与说明原样进任务记录。 */
export class EditorWasmUnavailable extends Error {
  readonly code = 'EDITOR_WASM_UNAVAILABLE';
  constructor(detail: string) {
    super(`The editor semantics WASM is unavailable. Run npm run build:wasm first (${detail})`);
    this.name = 'EditorWasmUnavailable';
  }
}

/**
 * 由 WASM 算出的模块级常量（取值区间、元素配方，以及由它们拼成的目录）：第一次读的时候才算。模块载入时不碰 WASM，
 * 没有构建时界面照常载入，读到这份常量才抛 `EditorWasmUnavailable`；算失败了下次读再算。
 * 代理的目标就是装结果的那个对象或数组，算出来后整个填进去，之后的读取都落在它上面。
 */
export function lazyObject<T extends object>(init: () => T): T {
  return filledOnFirstRead({} as T, init, (target, value) => Object.assign(target, value));
}

/** 同 `lazyObject`，结果是数组（`Array.isArray`、展开与数组方法照常）。 */
export function lazyArray<T>(init: () => readonly T[]): readonly T[] {
  return filledOnFirstRead([] as T[], init, (target, value) => target.push(...value));
}

function filledOnFirstRead<C extends object, V>(target: C, init: () => V, fill: (target: C, value: V) => void): C {
  let filled = false;
  const ready = (): C => {
    if (!filled) {
      fill(target, init());
      filled = true;
    }
    return target;
  };
  return new Proxy(target, {
    get: (_, key, receiver) => Reflect.get(ready(), key, receiver),
    has: (_, key) => Reflect.has(ready(), key),
    ownKeys: () => Reflect.ownKeys(ready()),
    getOwnPropertyDescriptor: (_, key) => Reflect.getOwnPropertyDescriptor(ready(), key),
  });
}

interface Exports {
  memory: WebAssembly.Memory;
  bc_alloc(len: number): number;
  bc_free(ptr: number, len: number): void;
  bc_speech_sentences(ptr: number, len: number): number;
  bc_stage_box(ptr: number, len: number): number;
  bc_stage_place(ptr: number, len: number): number;
  bc_place_default(ptr: number, len: number): number;
  bc_engine_ranges(ptr: number, len: number): number;
  bc_element_presets(ptr: number, len: number): number;
  bc_speaker_proposal(ptr: number, len: number): number;
  bc_apply_speakers(ptr: number, len: number): number;
  bc_source_chapters(ptr: number, len: number): number;
  bc_output_ptr(): number;
  bc_output_len(): number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class EditorSemantics {
  private readonly exports: Exports;

  private constructor(exports: Exports) {
    this.exports = exports;
  }

  /** 同步编译并实例化。 */
  static instantiate(bytes: Uint8Array<ArrayBuffer>): EditorSemantics {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    return new EditorSemantics(instance.exports as unknown as Exports);
  }

  /**
   * 转写正文（`baocut.speech/1`）的句子：句末标点、停顿不少于 1.8 秒、换说话人、句内 80 词、分段与章节边界断句；
   * 正文里存下的 `sentences` 不参与。正文不合格式、词缺源时间或说话人不合法时抛 `EditorWasmError`。
   */
  speechSentences(body: unknown): SpeechSentences {
    return this.call('bc_speech_sentences', body);
  }

  /** 实例在画布上的框（帧计划按它画）。 */
  stageBox(item: StageItem, canvas: StageCanvas, asset?: StageAsset): StageBox {
    return this.call('bc_stage_box', { item, asset, canvas });
  }

  /**
   * 框 → `place`（`stageBox` 的反函数）：`scale` 不动，框宽折成 `w`，框高写进 `scaleY`（按落盘的宽推出的自然高之比）；
   * 铺满画布的只写角度。什么都没变是空对象。
   */
  stagePlace(item: StageItem, pose: StagePose, canvas: StageCanvas, asset?: StageAsset): PlaceChange {
    return this.call('bc_stage_place', { item, asset, canvas, pose });
  }

  /** 种类的缺省落位：`place` 一个字段都不写时框落在哪。 */
  placeDefault(type: string): PlaceDefault {
    return this.call('bc_place_default', { type });
  }

  /** 引擎校验用的取值区间与缺省值（不变的表，取一次）。 */
  engineRanges(): EngineRanges {
    return (this.ranges ??= this.call<EngineRanges>('bc_engine_ranges', {}));
  }

  /** 声波、进度条与彩纸的样式目录（不变的表，取一次）。 */
  elementPresets(): ElementPresets {
    return (this.presets ??= this.call<ElementPresets>('bc_element_presets', {}));
  }

  /**
   * 识别说话人的提案：`labels` 与正文的词一一对应（声纹区分投影到的聚类，没有证据为 null）。聚类按重叠时长复用已有的
   * 说话人，复用不上的新建 `spk-<n>`「说话人 n」。`translations` 只给 `baocut.translation/2` 的正文。
   */
  speakerProposal(speech: unknown, translations: readonly unknown[], labels: ReadonlyArray<string | null>): SpeakerProposal {
    return this.call('bc_speaker_proposal', { speech, translations, labels });
  }

  /** 应用提案（`speakers` 带确认页上改过的名字）：新的说话人边界切开句子时译文按自然缝重切，不重新翻译。 */
  applySpeakers(
    speech: unknown,
    translations: readonly unknown[],
    wordSpeakers: Readonly<Record<string, string>>,
    speakers: ReadonlyArray<{ id: string; name: string }>,
  ): AppliedSpeakers {
    return this.call('bc_apply_speakers', { speech, translations, wordSpeakers, speakers });
  }

  /**
   * 来源自带章节：显式大纲优先，其次素材的来源元数据（结构化 `chapters[]`，没有再解析简介里的时间戳大纲）；有转写时把每条吸到
   * 最近的段落、句子起点（作者的时间戳只精确到秒，常比话题起点早几秒）。时间都是源时间秒，投影到时间线由调用方做。
   */
  sourceChapters(input: SourceChaptersInput): SourceChaptersResult {
    return this.call('bc_source_chapters', input);
  }

  private ranges: EngineRanges | undefined;
  private presets: ElementPresets | undefined;

  private call<T>(
    name: Exclude<keyof Exports, 'memory' | 'bc_alloc' | 'bc_free' | 'bc_output_ptr' | 'bc_output_len'>,
    payload: unknown,
  ): T {
    const input = encoder.encode(JSON.stringify(payload));
    const { exports } = this;
    const ptr = exports.bc_alloc(input.length);
    try {
      new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
      const status = exports[name](ptr, input.length);
      // 调用之后内存可能长过，重新取 buffer。
      const output = decoder.decode(new Uint8Array(exports.memory.buffer, exports.bc_output_ptr(), exports.bc_output_len()));
      const value = JSON.parse(output) as unknown;
      if (status !== 0) {
        const error = value as { code: string; message: string };
        throw new EditorWasmError(error.code, error.message);
      }
      return value as T;
    } finally {
      exports.bc_free(ptr, input.length);
    }
  }
}

/** 同步的函数形式（Node 与浏览器两侧导出同一组）：`get` 第一次调用时载入 WASM。 */
export function semanticsApi(get: () => EditorSemantics) {
  return {
    speechSentences: (body: unknown): SpeechSentences => get().speechSentences(body),
    stageBox: (item: StageItem, canvas: StageCanvas, asset?: StageAsset): StageBox => get().stageBox(item, canvas, asset),
    stagePlace: (item: StageItem, pose: StagePose, canvas: StageCanvas, asset?: StageAsset): PlaceChange =>
      get().stagePlace(item, pose, canvas, asset),
    placeDefault: (type: string): PlaceDefault => get().placeDefault(type),
    engineRanges: (): EngineRanges => get().engineRanges(),
    elementPresets: (): ElementPresets => get().elementPresets(),
    speakerProposal: (speech: unknown, translations: readonly unknown[], labels: ReadonlyArray<string | null>): SpeakerProposal =>
      get().speakerProposal(speech, translations, labels),
    applySpeakers: (
      speech: unknown,
      translations: readonly unknown[],
      wordSpeakers: Readonly<Record<string, string>>,
      speakers: ReadonlyArray<{ id: string; name: string }>,
    ): AppliedSpeakers => get().applySpeakers(speech, translations, wordSpeakers, speakers),
    sourceChapters: (input: SourceChaptersInput): SourceChaptersResult => get().sourceChapters(input),
  };
}
