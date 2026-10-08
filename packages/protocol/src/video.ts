import type { Id, Seq } from './domain.ts';
import type { MessageRef } from './message-ref.ts';

/**
 * 视频领域的线上 DTO（视频格式规范 §2–§4；命令与协议规范 §4–§6、§10）。
 *
 * 语义与校验由 Rust 视频引擎单源定义（架构设计 §13.2）。这些类型是按引擎的 serde 输出手写的镜像，
 * 字段名与取值和 `crates/video-model`（画面元素是 v2 的元素模型，`crates/timeline` 的 `schema.rs`）、
 * `crates/video-engine/src/ops.rs` 与 `receipt.rs` 一一对应；生成工具随后补上。格式版本只有 3。
 */

export type Revision = string;

/** 正的整数比，已约分。帧率、时间基、速度都用它。 */
export interface Rate {
  num: number;
  den: number;
}

/** 精确时间：`ticks / timescale` 秒。`ticks` 是十进制整数字符串，避免 64 位整数丢精度。 */
export interface MediaTime {
  ticks: string;
  timescale: number;
}

export interface VersionRef {
  id: Id;
  revision: Revision;
}

export interface FrameSpan {
  fromFrame: number;
  durationFrames: number;
}

export type TimeMap = { kind: 'linear'; sourceIn: MediaTime; rate: Rate } | { kind: 'hold'; sourceAt: MediaTime };

export type TrackKind = 'visual' | 'audio' | 'subtitle';
/** `arrangeItem` 的方向：往上一层、往下一层、最上、最下。 */
export type ArrangeDirection = 'forward' | 'backward' | 'front' | 'back';

export interface Track {
  id: Id;
  order: number;
  kind: TrackKind;
  name?: string;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  solo: { enabled: boolean; group: 'audio' | 'visual' };
}

export interface ItemLineage {
  originItemId: Id;
  parentItemId?: Id;
  viaTransactionId: Id;
}

/** 语义锚点（视频格式规范 §3.16）：实例的起点或终点钉在一个词、一句话、另一个实例的局部时刻或序列的一帧上。 */
export type SemanticAnchor =
  | { kind: 'word'; speechRef: VersionRef; wordId: Id; occurrenceId?: Id; edge: 'start' | 'end'; offset?: MediaTime }
  | { kind: 'sentence'; speechRef: VersionRef; sentenceId: Id; occurrenceId?: Id; edge: 'start' | 'end' }
  | { kind: 'item'; itemId: Id; localOffset: MediaTime }
  | { kind: 'sequence'; sequenceId: Id; frame: number };

/**
 * 实例跟着什么移动（视频格式规范 §3.16）。`addCuts`、`restoreCut` 按它移动 `follow-cuts` 的实例；新建的实例缺省 `follow-cuts`，
 * `sequence-fixed` 要显式选择（`insertItems` 或 `updateItem` 写明）。
 */
export type FollowPolicy =
  | { kind: 'sequence-fixed' }
  | { kind: 'follow-cuts' }
  | { kind: 'item-local'; itemId: Id }
  | { kind: 'speech-anchor'; start?: SemanticAnchor; end?: SemanticAnchor }
  | { kind: 'explicit-link-group'; groupId: Id };

interface ItemBase {
  id: Id;
  trackId: Id;
  name?: string;
  enabled: boolean;
  locked: boolean;
  paintOrder: number;
  followPolicy: FollowPolicy;
  lineage?: ItemLineage;
  linkGroupId?: Id;
  /**
   * 实例在视频里的作用（开放词表）。`broll`、`watermark`、`screentext`、`overlay`、`frame` 写入时校验与种类的搭配：
   * `broll` 只用于图片与视频，`screentext` 只用于文字，`watermark` 用于文字、图片、视频与贴纸，`overlay`、`frame` 用于图片、视频与贴纸。
   */
  role?: string;
  /** 生成来源的说明；引擎不解释，原样保留。 */
  ai?: unknown;
  /** 终点跟着序列末尾（§3.16）：引擎在每笔编辑事务的最后求出 `span` 的终点，写入的长度不算数。不是时省略。 */
  untilSequenceEnd?: boolean;
  /** 命名空间下的扩展：引擎不解释，写回时保留。空的时候省略。 */
  extensions?: Record<string, unknown>;
}

/** 四角各自的圆角，540 短边下的像素。 */
export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

/**
 * 画面实例的位置（视频格式规范 §3.5，v2 的元素模型）：`x`、`y` 是框中心在画幅里的百分比，`w` 是框宽占画幅宽的百分比
 * （正方款按短边量），高由种类推出；`scale`、`scaleY` 乘在宽高上，`rot` 是绕中心顺时针的角度。省略的字段取按种类的缺省。
 */
export interface Place {
  x?: number;
  y?: number;
  w?: number;
  scale?: number;
  scaleY?: number;
  rot?: number;
  /** [0, 1]，缺省 1。 */
  opacity?: number;
  /** 整个框的圆角，540 短边下的像素。 */
  radius?: number;
  cornerRadii?: CornerRadii;
  /** 为 false 时省略。 */
  flipX?: boolean;
  flipY?: boolean;
}

/** 视觉媒体的摆法：铺满画布，或按源的宽高比摆成画中画。缺省 `pip`。 */
export type VisualMode = 'fullscreen' | 'pip';
/** 源画面怎么放进框里。缺省 `cover`。 */
export type FitMode = 'cover' | 'contain';
/** 铺满加 `contain` 时框里其余部分画什么：模糊的源、黑色或一种颜色（`#RRGGBB`）。缺省 `black`。 */
export type MediaBackground = 'blur' | 'black' | (string & {});

/** 遮罩：内切于框的椭圆，`feather` 是 540 短边下的像素。 */
export interface Mask {
  shape: 'ellipse';
  feather?: number;
}

/** 平铺（图片与文字）。 */
export interface Tile {
  on: boolean;
  angle?: number;
  gapX?: number;
  gapY?: number;
  stagger?: boolean;
}

export type FilterPreset =
  | 'none'
  | 'calm1'
  | 'calm2'
  | 'calm3'
  | 'clean1'
  | 'clean2'
  | 'clean3'
  | 'cottage1'
  | 'cottage2'
  | 'cottage3'
  | 'peckham1'
  | 'peckham2'
  | 'peckham3';
export type EffectPreset =
  'none' | 'invert' | 'night_vision' | 'thermal_vision' | 'old' | 'polaroid' | 'filmic' | 'snowy' | 'box_blur' | 'bokeh_blur';

/**
 * 画面效果（视频格式规范 §3.8）：固定字段，省略的不生效。调色字段在 [-1, 1]（`hue` 乘 180 度），`blur` 在 [0, 100]，
 * 长度都是 540 短边下的像素。`temperature`、`shadow`、`stroke` 是 v3 并进来的三种。
 */
export interface Fx {
  filterPreset?: FilterPreset;
  effectPreset?: EffectPreset;
  effectIntensity?: number;
  grayscale?: number;
  brightness?: number;
  exposure?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  temperature?: number;
  blur?: number;
  sharpen?: number;
  noise?: number;
  vignette?: number;
  /** 阴影：alpha 轮廓平移、模糊、填色，画在画面下面。向右、向下为正。 */
  shadow?: { offsetX: number; offsetY: number; blur: number; color: string; opacity: number };
  /** 描边：沿 alpha 轮廓的外侧画一圈，`width` 在 (0, 100]。 */
  stroke?: { width: number; color: string };
}

/** 元素动画的一槽（视频格式规范 §3.15）。`preset` 是封闭的名字表。 */
export interface AnimationSlot {
  preset: string;
  presetVersion?: number;
  dur?: number;
  delay?: number;
  intensity?: number;
  ease?: string;
  stagger?: number;
  staggerFrom?: string;
  period?: number;
  phase?: number;
  seed?: number;
}

/** 元素动画的三槽：入场、出场、循环。 */
export interface Animation {
  enter?: AnimationSlot;
  exit?: AnimationSlot;
  loop?: AnimationSlot;
}

/** 可以打关键帧的属性（`place` 里的数值字段）。 */
export type KeyframeProperty = 'x' | 'y' | 'scale' | 'scaleY' | 'rot' | 'opacity' | 'radius';

/** 一个关键帧：时刻是实例局部的帧或实例长度的百分比，二选一。 */
export interface Keyframe {
  localFrame?: number;
  percent?: number;
  value: number;
  ease?: string;
}

/** 关键帧绑定（视频格式规范 §3.15）：一个实例的一个属性。存在序列上。 */
export interface AnimationBinding {
  id: Id;
  targetId: Id;
  propertyPath: KeyframeProperty;
  keyframes: Keyframe[];
}

/** 源画面的裁剪：从源的显示画面四边各裁掉的比例，在 `fit` 之前生效（视频格式规范 §3.5）。每边在 [0, 1)，左右、上下之和小于 1。 */
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 视觉媒体的字段：视频、图片、素材贴纸、占位框与白板共用。 */
export interface MediaFields {
  mode?: VisualMode;
  fit?: FitMode;
  bg?: MediaBackground;
  mask?: Mask;
  fx?: Fx;
}

/** 视频实例的内嵌音频、合成实例自己的声音（视频格式规范 §3.9）。 */
export interface EmbeddedAudio {
  enabled: boolean;
  /** 线性倍数，[0, 4]。 */
  volume: number;
  fadeIn?: MediaTime;
  fadeOut?: MediaTime;
  /** 空的时候省略。 */
  envelope?: EnvelopePoint[];
}

/** 画面实例共有的字段：区间、位置与元素动画。 */
interface VisualBase extends ItemBase {
  span: FrameSpan;
  place: Place;
  animate?: Animation;
}

export interface VideoItem extends VisualBase, MediaFields {
  type: 'video';
  assetRef: VersionRef;
  timeMap: TimeMap;
  /** 没有裁剪时省略。 */
  crop?: Crop;
  embeddedAudio: EmbeddedAudio;
}

export interface ImageItem extends VisualBase, MediaFields {
  type: 'image';
  assetRef: VersionRef;
  crop?: Crop;
  tile?: Tile;
  /** 图片的编辑来源（`file` / `html`）；渲染只用 `assetRef`。 */
  source?: string;
  /** `source` 为 `html` 时保留的原始片段。 */
  html?: string;
}

/** 计时读数：倒计时或正计时。 */
export interface CounterProps {
  mode: 'countdown' | 'countup';
  /** 缺省 `s`。 */
  format?: 's' | 'mm:ss' | 'hh:mm:ss';
}

/**
 * 文字实例：一段文字或计时读数，加文字样式（视频格式规范 §3.6）。`text` 与 `counter` 二选一。
 * `style` 是 v2 的文字样式对象，引擎按对象保存。
 */
export interface TextItem extends VisualBase {
  type: 'text';
  text?: string;
  counter?: CounterProps;
  style?: Record<string, unknown>;
  stylePresetId?: string;
  /** `place.y` 钉住文字块的哪一处，缺省 `center`。 */
  verticalAlign?: 'top' | 'center' | 'bottom';
  tile?: Tile;
}

/** 图形的参数（v2 的 `ShapeProps`）。`h` 是框高占画幅高的百分比，省略时是正方形；`line`、`arrow` 用端点（框内百分比）。 */
export interface ShapeProps {
  shape: string;
  /** `#RRGGBB` 或 `#RRGGBBAA`。 */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: [number, number, number, number];
  h?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

export interface ShapeItem extends VisualBase {
  type: 'shape';
  shape: ShapeProps;
}

/** 贴纸：`template` 贴纸画目录里的矢量，`asset` 贴纸画 `assetRef` 指向的图片、视频或 Lottie。 */
export interface StickerProps {
  source: 'template' | 'asset' | (string & {});
  templateId?: string;
  path?: string;
  loop?: string;
  fillOverrides?: Record<string, string>;
}

export interface StickerItem extends VisualBase, MediaFields {
  type: 'sticker';
  assetRef?: VersionRef;
  sticker: StickerProps;
}

export interface VisualizerProps {
  style: string;
  mainColor?: string;
  secondaryColor?: string;
  fftSize?: number;
  minDb?: number;
  maxDb?: number;
  smoothing?: number;
  gain?: number;
  audio?: string;
  speaker?: string;
  alwaysShow?: boolean;
}

/** 声波。 */
export interface VisualizerItem extends VisualBase {
  type: 'visualizer';
  visualizer: VisualizerProps;
}

export interface ProgressProps {
  style: string;
  mainColor?: string;
  secondaryColor?: string;
  /** 归一化起止值；允许 `start > end` 表达倒向进度。 */
  startProgress?: number;
  endProgress?: number;
}

/** 进度条。 */
export interface ProgressItem extends VisualBase {
  type: 'progress';
  progress: ProgressProps;
}

export interface DrawProps {
  brush: 'round' | 'sliced';
  color: string;
  size: number;
  alpha?: number;
  strokes?: { points: [number, number][] }[];
}

/** 手绘。 */
export interface DrawItem extends VisualBase {
  type: 'draw';
  draw: DrawProps;
}

export interface PlaceholderProps {
  variant: 'camera' | 'media' | 'screen';
  notes?: string;
}

/** 占位框：没有 `assetRef` 时画占位的外观，有时按视觉媒体画。 */
export interface PlaceholderItem extends VisualBase, MediaFields {
  type: 'placeholder';
  assetRef?: VersionRef;
  placeholder: PlaceholderProps;
}

export interface ConfettiProps {
  style: string;
  seed?: number;
  colors?: string[];
  shapes?: string[];
  size?: number;
  speed?: number;
  gravity?: number;
  drift?: number;
  spin?: number;
  wind?: number;
  opacity?: number;
  emit?: unknown;
  origin?: unknown;
  angle?: number;
  spread?: number;
}

/** 彩纸。 */
export interface ConfettiItem extends VisualBase {
  type: 'confetti';
  confetti: ConfettiProps;
}

export interface WhiteboardProps {
  hand?: 'marker' | 'pen' | 'none';
  paper?: string;
  draw?: number;
  inkFirst?: boolean;
  pace?: unknown;
  strict?: boolean;
  beats?: unknown[];
}

/** 白板手绘：一个图片素材按推导出的顺序画出来。 */
export interface WhiteboardItem extends VisualBase, MediaFields {
  type: 'whiteboard';
  assetRef: VersionRef;
  whiteboard: WhiteboardProps;
}

export type CompositionSource = { kind: 'bundle'; assetRef: VersionRef };

/** 合成实例：由代码包按局部时间画出来的画面（视频格式规范 §3.7）。`place` 没写位置与宽时铺满画布。 */
export interface CompositionItem extends VisualBase {
  type: 'composition';
  source: CompositionSource;
  parameterValues: unknown;
  timeMap: TimeMap;
  /**
   * 预渲染替身：把这段合成渲染好的视频素材，与合成共用一条时间映射。
   * 合成的运行环境不可用或来不及实时渲染时，预览与导出用它代替。
   */
  prerender?: VersionRef;
  /** 合成自己发出的声音的路由；没有声音的合成不写。 */
  audio?: EmbeddedAudio;
  mask?: Mask;
  fx?: Fx;
}

/** 字幕实例：在一段序列时间里显示一份字幕文档（视频格式规范 §3.8）。它跟随文档的当前版本，所以引用的是文档 ID。只在字幕轨道上。 */
export interface CaptionItem extends ItemBase {
  type: 'caption';
  span: FrameSpan;
  documentId: Id;
  styleDocumentId?: Id;
  /** 字幕的词时间经过哪些实例的 timeMap 投影到序列上。省略（空）表示文档里的时间已经是序列时间。 */
  scopeItemIds?: Id[];
}

/** 音量包络的一个点：时刻是实例局部的精确时间或实例长度的百分比，二选一。 */
export interface EnvelopePoint {
  at?: MediaTime;
  percent?: number;
  /** 线性倍数，[0, 4]。 */
  volume: number;
  /** 进入这一点的那一段的缓动，缺省 `linear`。 */
  ease?: string;
}

/** 混音（视频格式规范 §3.9）。增益只有线性倍数 `volume`。 */
export interface AudioMix {
  /** 线性倍数，[0, 4]，缺省 1。 */
  volume: number;
  /** 为 false 时省略。 */
  muted?: boolean;
  fadeIn?: MediaTime;
  fadeOut?: MediaTime;
  /** 音量包络；有它时取代 `volume`。空的时候省略。 */
  envelope?: EnvelopePoint[];
}

/** 音频实例的开始位置是 `fromFrame` + `subframeOffset`，不吸附到帧（视频格式规范 §2.10）。 */
export interface AudioItem extends ItemBase {
  type: 'audio';
  assetRef: VersionRef;
  fromFrame: number;
  subframeOffset: MediaTime;
  playDuration: MediaTime;
  timeMap: TimeMap;
  mix: AudioMix;
}

/** 有 `span` 与 `place` 的画面实例。 */
export type VisualItem =
  | VideoItem
  | ImageItem
  | TextItem
  | ShapeItem
  | StickerItem
  | VisualizerItem
  | ProgressItem
  | DrawItem
  | PlaceholderItem
  | ConfettiItem
  | WhiteboardItem
  | CompositionItem;

/** 序列上的一个实例（与会话里的 `TimelineItem` 无关）。 */
export type SequenceItem = VisualItem | AudioItem | CaptionItem;

/** 画面实例（有 `place`）。 */
export function isVisualItem(item: SequenceItem): item is VisualItem {
  return item.type !== 'audio' && item.type !== 'caption';
}

/** 实例的内容引用的素材版本。文字、图形、生成类元素与字幕没有。 */
export function itemAssetRef(item: SequenceItem): VersionRef | undefined {
  switch (item.type) {
    case 'video':
    case 'image':
    case 'audio':
    case 'whiteboard':
      return item.assetRef;
    case 'sticker':
    case 'placeholder':
      return item.assetRef;
    case 'composition':
      return item.source.assetRef;
    default:
      return undefined;
  }
}

/** 实例引用的全部素材版本：内容本身，加上合成的预渲染替身。 */
export function itemAssetRefs(item: SequenceItem): VersionRef[] {
  const refs: VersionRef[] = [];
  const content = itemAssetRef(item);
  if (content) refs.push(content);
  if (item.type === 'composition' && item.prerender) refs.push(item.prerender);
  return refs;
}

/** 实例时间到源时间的映射。没有源时间的实例（图片、文字、图形、生成类元素、字幕）没有。 */
export function itemTimeMap(item: SequenceItem): TimeMap | undefined {
  return item.type === 'video' || item.type === 'audio' || item.type === 'composition' ? item.timeMap : undefined;
}

/** 线性倍数换成 dB（显示用）：0 记作 -Infinity。 */
export function volumeToDb(volume: number): number {
  return 20 * Math.log10(volume);
}

/** dB 换成线性倍数（显示用）。 */
export function dbToVolume(db: number): number {
  return 10 ** (db / 20);
}

/**
 * 这个版本定义的转场种类（视频格式规范 §3.9）。前五种可以单侧也可以两侧，没有参数；`dip-to-color`（{color: '#RRGGBB'}）
 * 与 `push`（{direction}）只用于两侧。
 */
export type TransitionKind = 'dissolve' | 'wipe' | 'slide' | 'zoom' | 'iris' | 'dip-to-color' | 'push';
/** 可以单侧也可以两侧的种类。 */
export const SINGLE_SIDED_TRANSITION_KINDS: readonly TransitionKind[] = ['dissolve', 'wipe', 'slide', 'zoom', 'iris'];
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
/** 转场窗口相对剪切点的位置：居中、从剪切点开始、在剪切点结束。单侧转场只能居中。 */
export type TransitionPlacement = 'center' | 'start-at-cut' | 'end-at-cut';

/**
 * 转场（视频格式规范 §3.9）：两个首尾相接的同轨画面实例之间（两个 ID 都有），或一个实例的开头（只有 `rightItemId`）、
 * 结尾（只有 `leftItemId`）。单侧转场写入的长度不变，生效的长度是 min(长度, ⌊实例长度/2⌋)。认不出的种类原样保留，渲染成硬切。
 */
export interface Transition {
  id: Id;
  leftItemId?: Id;
  rightItemId?: Id;
  kind: TransitionKind | (string & {});
  /** 空的时候省略。 */
  params?: Record<string, unknown>;
  durationFrames: number;
  easing: Easing;
  placement: TransitionPlacement;
  /** 为 false 时省略。 */
  audioCrossfade?: boolean;
}

/** 序列上的标记（视频格式规范 §3.13）。`kind: 'chapter'` 的是章节，固定在序列时间上，不跟着实例移动。 */
export interface Marker {
  id: Id;
  frame: number;
  durationFrames?: number;
  label: string;
  kind?: 'chapter' | 'note' | 'todo';
  summary?: string;
  thumbnail?: VersionRef;
}

/** 闪避规则的一组：轨道上的全部实例，加上单独点名的实例。 */
export interface DuckingGroup {
  trackIds?: Id[];
  itemIds?: Id[];
}

/** 闪避的触发：有人说话时（按文稿的词流），或这些实例发声时。 */
export type DuckingTrigger = { kind: 'speech' } | ({ kind: 'items' } & DuckingGroup);

/**
 * 闪避（视频格式规范 §3.9）：触发的时间段里，目标组压低 `depth` dB，提前 `attack` 开始下降、结束后用 `release` 恢复。
 */
export interface DuckingRule {
  id: Id;
  name?: string;
  enabled: boolean;
  trigger: DuckingTrigger;
  target: DuckingGroup;
  /** [0, 60] dB。 */
  depth: number;
  attack: MediaTime;
  release: MediaTime;
}

/** 模板层的一层：框是画幅百分比（左上角与宽高），其余字段按层的种类。 */
export interface TemplateLayer {
  id: string;
  /** 缺省 true。 */
  on?: boolean;
  box: { x: number; y: number; w: number; h: number };
  [key: string]: unknown;
}

/** 序列的模板层（视频格式规范 §3.17，v2 的模板文档）。 */
export interface TemplateLayers {
  id: string;
  name: string;
  layers: TemplateLayer[];
  [key: string]: unknown;
}

export interface Sequence {
  id: Id;
  revision: Revision;
  name: string;
  fps: Rate;
  /** `background` 是不透明的纯色 `#RRGGBB`（大写）。 */
  canvas: { width: number; height: number; workingSpace: string; background: string };
  durationPolicy: { kind: 'derived' } | { kind: 'fixed'; frames: number };
  /** 关键帧绑定（§3.15）。 */
  animationBindings: AnimationBinding[];
  /** 模板层；没有时省略。 */
  template?: TemplateLayers;
  tracks: Track[];
  items: SequenceItem[];
  /** 按 ID 排序。 */
  transitions: Transition[];
  /** 按帧排序（同帧按 ID）。 */
  markers: Marker[];
  /** 按 ID 排序。 */
  ducking: DuckingRule[];
}

/** `bundle` 是代码包：一个目录。 */
export type AssetKind = 'video' | 'audio' | 'image' | 'lottie' | 'font' | 'caption' | 'document' | 'bundle' | 'other';

export interface FileLocator {
  /** 绝对路径，或相对视频目录的路径（文件在项目目录里时）。 */
  path: string;
  /** 链接时文件的修改时间。 */
  modifiedAt?: string;
  /** 所在卷的名字，文件找不到时用来提示「请接上某个盘」。 */
  volume?: string;
}

/**
 * 此刻读不到的一个素材版本（`videos.assetStatus`，视频格式规范 §4.2）。`reason` 与 `ASSET_MISSING` 错误的 `details.reason` 相同：
 * `missing` 文件不在了；`changed` 已经不是登记时的文件（长度不符）；`outside-project` 相对路径越出了项目目录，不予读取。
 */
export interface MissingAsset {
  assetId: Id;
  revision: Revision;
  reason: 'missing' | 'changed' | 'outside-project';
  /** 链接素材登记的路径（相对视频目录，或绝对路径）；收进视频的素材没有。 */
  path?: string;
  /** 所在卷的名字，用来提示「请接上某个盘」。 */
  volume?: string;
}

/**
 * 一个没有任何引用的素材（`videos.unusedAssets`，`removeAssets` 能删的那些）。引用包括所有序列上的实例与它的预渲染替身、
 * 章节缩略图、文档的来源素材。
 */
export interface UnusedAsset {
  assetId: Id;
  name: string;
  kind: AssetKind;
  mediaType: string;
  /** 当前版本的字节数。 */
  byteLength: number;
  /** `managed`：bytes 在视频目录里；`linked`：文件留在原处，删掉记录不动它。 */
  storage: 'managed' | 'linked';
  /** 成对的另一半（代码包 ↔ 它烘焙出的预渲染替身），同样没有引用；删掉其中一个时一起删。没有时省略。 */
  pairedWith?: Id[];
}

/** bytes 放在哪里（视频格式规范 §4.2）：在视频目录的 `blobs/` 里，或留在原处、视频只记下去哪里找。位置不属于版本的身份。 */
export type AssetStorage = { mode: 'managed' } | { mode: 'linked'; locator: FileLocator; frozen: boolean };

/** 来源（视频格式规范 §4.5）。本机路径只出现在 `storage.locator` 里。 */
export interface Provenance {
  origin: string;
  importedFrom?: { originalName: string; importedAt: string };
  /** 已知的出处：来源网址、原平台的元数据、生成记录等。 */
  source?: unknown;
}

export interface AssetRevision {
  revision: Revision;
  contentHash: string;
  byteLength: number;
  mediaType: string;
  storage: AssetStorage;
  duration?: MediaTime;
  timebase?: Rate;
  video?: {
    displayWidth: number;
    displayHeight: number;
    rotation: number;
    pixelAspectRatio: Rate;
    frameRate: { kind: 'cfr'; rate: Rate } | { kind: 'vfr'; nominal?: Rate };
    ptsOrigin: MediaTime;
    hasAlpha: boolean;
  };
  audio?: { sampleRate: number; channels: number; layout?: string };
  /** 素材是一个目录时的文件清单概要。`include` 省略表示整个目录。 */
  tree?: { fileCount: number; include?: string[] };
  /** 代码包的清单（代码包规范 §2）。引擎按对象保存。 */
  bundle?: unknown;
  provenance: Provenance;
}

export interface AssetRecord {
  id: Id;
  kind: AssetKind;
  name: string;
  currentRevision: Revision;
  revisions: Record<Revision, AssetRevision>;
}

export interface DocumentRevision {
  revision: Revision;
  contentHash: string;
  byteLength: number;
  createdAt: string;
  /** 写入这个版本的事务。 */
  createdBy: Id;
  /** 正文的概要（词数、句数等），让列表与智能体不必读正文。 */
  summary?: unknown;
}

/** 文档头（视频格式规范 §4.4）：身份与各个版本的指纹。正文按版本保存在存储里，不随快照下发。 */
export interface DocumentRecord {
  id: Id;
  /** 文档的种类：`speech`、`translation`、`caption`、`caption-style`……（开放词表）。 */
  kind: string;
  name: string;
  language?: string;
  /** 这份文档描述的素材（例如转写对应的录音）。 */
  sourceAssetId?: Id;
  /** 这份文档派生自哪份文档（例如译文对应的转写）。 */
  sourceDocumentId?: Id;
  currentRevision: Revision;
  revisions: Record<Revision, DocumentRevision>;
  extensions?: Record<string, unknown>;
}

/** 一份文档某个版本的正文（`documents.read`）。 */
export interface DocumentContent {
  document: DocumentRecord;
  revision: Revision;
  body: unknown;
}

export interface Checkpoint {
  id: Id;
  name: string;
  videoRevision: Revision;
  createdAt: string;
  origin: { by: string; taskId?: Id };
  note?: string;
}

/** 视频快照（视频格式规范 §3.1）。文稿类内容（转写、翻译、字幕样式等）在 `documents` 里只有文档头，正文按版本另取。 */
export interface VideoSnapshot {
  format: 'baocut.video';
  schemaVersion: number;
  timeContractVersion: number;
  id: Id;
  name: string;
  revision: Revision;
  rootSequenceId: Id;
  sequences: Record<Id, Sequence>;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
  fonts: Record<Id, unknown>;
  localizationSets: Record<Id, unknown>;
  canvasVariants: Record<Id, unknown>;
  syncGroups: Record<Id, unknown>;
  protections: Record<Id, unknown>;
  checkpoints: Record<Id, Checkpoint>;
  links: unknown[];
}

// ---- 编辑操作（命令与协议规范 §4.2）----
// 带时间输入的操作必须写明 `sequenceId`：时间按那个序列的帧率量化（§6.1）。

export type TimelineTimeInput = { unit: 'seconds'; value: string } | { unit: 'frames'; value: number };
export type FrameAlignment = 'exact-frame' | 'nearest-frame' | 'floor-frame' | 'ceil-frame';

type EngineManaged = 'enabled' | 'locked' | 'paintOrder' | 'followPolicy';
/** 放在哪条轨道：已有轨道的 ID，或同一事务里 `addTrack` 的 `ref`。 */
type TrackTarget = { trackId: Id; trackRef?: never } | { trackRef: string; trackId?: never };
/** 字幕实例引用的文档：已有文档的 ID，或同一事务里 `putDocument` 的 `ref`。 */
type CaptionDocuments = ({ documentId: Id; documentRef?: never } | { documentRef: string; documentId?: never }) &
  ({ styleDocumentId?: Id; styleDocumentRef?: never } | { styleDocumentRef: string; styleDocumentId?: never });
/** 媒体实例的素材：已有素材的版本，或同一事务里 `importAsset` 的 `ref`（引擎取那个素材的当前版本）。 */
type AssetTarget = { assetRef: VersionRef; assetImportRef?: never } | { assetImportRef: string; assetRef?: never };
type OptionalAssetTarget = { assetRef?: VersionRef; assetImportRef?: never } | { assetImportRef: string; assetRef?: never };
type ItemInput<Item> = Item extends CaptionItem
  ? Omit<Item, 'id' | 'lineage' | EngineManaged | 'trackId' | 'documentId' | 'styleDocumentId'> &
      Partial<Pick<Item, EngineManaged>> &
      TrackTarget &
      CaptionDocuments
  : Item extends VideoItem | ImageItem | AudioItem | WhiteboardItem
    ? Omit<Item, 'id' | 'lineage' | EngineManaged | 'trackId' | 'assetRef'> & Partial<Pick<Item, EngineManaged>> & TrackTarget & AssetTarget
    : Item extends StickerItem | PlaceholderItem
      ? Omit<Item, 'id' | 'lineage' | EngineManaged | 'trackId' | 'assetRef'> &
          Partial<Pick<Item, EngineManaged>> &
          TrackTarget &
          OptionalAssetTarget
      : Item extends SequenceItem
        ? Omit<Item, 'id' | 'lineage' | EngineManaged | 'trackId'> & Partial<Pick<Item, EngineManaged>> & TrackTarget
        : never;

/**
 * `insertItems` 写入的实例：字段与 `SequenceItem` 相同；`id` 与 `lineage` 由引擎分配，不能自带；引擎管的字段有默认值。
 * 轨道、字幕文档与媒体的素材可以用同一事务里新建的那个的 `ref`（`trackRef`、`documentRef`、`styleDocumentRef`、
 * `assetImportRef`）。
 */
export type SequenceItemInput = ItemInput<SequenceItem>;

/** `setDucking` 的一组：`DuckingGroup` 加上同一事务里新建轨道的 `ref`。 */
export type DuckingGroupInput = DuckingGroup & { trackRefs?: string[] };
/** `setDucking` 的触发：有人说话时，或这些轨道与实例发声时。 */
export type DuckingTriggerInput = { kind: 'speech' } | ({ kind: 'items' } & DuckingGroupInput);

/**
 * 剪口集合的正文（视频格式规范 §6.7，文档 `kind: 'cut-set'`）：一个源素材上被口播剪辑删掉的区间，按 `t0` 排序、互不重叠。
 * `t0`、`t1` 是整数刻度写成的十进制字符串，`ref` 是出处（剪辑建议的 ID）。由 `addCuts`、`restoreCut` 改写。
 */
export interface CutSetBody {
  schema: 'baocut.cut-set/1';
  timescale: number;
  clock: 'source-asset';
  scopeItemIds: Id[];
  cuts: { id: Id; t0: string; t1: string; ref?: Id }[];
}

/** 剪辑提案里的一条建议（视频格式规范 §6.2）：建议剪掉的源区间 `[t0, t1)`，整数刻度写成十进制字符串。 */
export interface CutSuggestion {
  id: Id;
  kind: 'filler' | 'pause';
  t0: string;
  t1: string;
  /** 口癖：区间里的词。 */
  wordIds?: Id[];
  /** 停顿：停顿之前的词。 */
  afterWordId?: Id;
  /** 区间里的文字：口癖是这些词的原文，停顿为空。 */
  text: string;
  /** 检测器写的短句，原样展示。 */
  reason: string;
  detail?: string;
  /** 0–1；检测器给不出时没有。 */
  confidence?: number;
  status: 'pending' | 'accepted';
}

/**
 * 剪辑提案的正文（视频格式规范 §6.2，文档 `kind: 'editorial-proposal'`，每个源素材至多一份）。由 `proposeCuts` 写出，
 * `acceptCutSuggestions` 把接受的建议标成 `accepted`。`speechRef` 是检测读的转写版本，转写之后改过时建议过期。
 */
export interface EditorialProposalBody {
  schema: 'baocut.editorial-proposal/1';
  timescale: number;
  clock: 'source-asset';
  speechRef: { id: Id; revision: Revision };
  suggestions: CutSuggestion[];
}

/** `proposeCuts` 的检测参数（视频格式规范 §6.2）；不给的取缺省。秒数是十进制字符串。 */
export interface CutDetectOptions {
  /** 检测长停顿，缺省 true。 */
  pauses?: boolean;
  /** 检测口癖，缺省 true。 */
  fillers?: boolean;
  /** 最短的停顿，缺省 0.8 秒。 */
  minPause?: string;
  /** 停顿压缩到的长度，缺省 0.3 秒（句末多留 0.1 秒，至多 0.5 秒）；须小于 `minPause`。 */
  compressTo?: string;
  /** 更长的间隔不算停顿，缺省 3 秒；须大于 `minPause`。 */
  maxGap?: string;
  /** 口癖表：`auto`（中英文，缺省）、`en` 或 `zh`。 */
  fillerLanguage?: 'auto' | 'en' | 'zh';
  /** 另外当作口癖的词。 */
  customFillers?: string[];
  /** 章节之间的停顿也压缩，缺省 false。 */
  trimChapterStarts?: boolean;
}

export type EditOperation =
  /** 导入一个文件或目录为素材（文件默认链接、留在原处）；目录成为代码包素材。`ref` 供同一事务里后面的操作引用。 */
  | {
      type: 'importAsset';
      path: string;
      name?: string;
      ref?: string;
      /**
       * bytes 留在原处（`linked`）还是复制进视频目录（`managed`）。不给时文件默认 `linked`；目录（代码包，没有原文件可以指向）
       * 默认 `managed`。`managed` 要求绝对路径，`linked` 可以给相对视频目录的路径。之后可以用 `collectAssets` 收进来。
       */
      storage?: 'managed' | 'linked';
      /** 导入目录时只收这些文件或子目录（相对路径）。 */
      include?: string[];
      /** 代码包的清单，只对目录有意义。 */
      bundle?: unknown;
      /** 导入方已知的来源。不给时按「用户导入」记录。 */
      provenance?: { origin: string; source?: unknown };
    }
  /** 把链接素材的 bytes 收进视频目录（`linked` → `managed`）。素材版本不变。 */
  | { type: 'collectAssets'; assetIds: Id[] }
  /**
   * 删掉没有任何引用的素材记录（实例与它的预渲染替身、章节缩略图、文档的来源都不再指向它）。还有引用时拒绝
   * （`INVALID_OPERATION`，`details.rule: 'asset-in-use'`，`details.usedBy` 列出谁在用）。代码包与它烘焙出的预渲染替身成对删除。
   * 只删记录，bytes 由 GC 回收；撤销能放回来。预检清单见 `videos.unusedAssets`。
   */
  | { type: 'removeAssets'; assetIds: Id[] }
  /** 链接素材换了位置：核对内容与登记的一致，然后更新定位。素材版本不变。 */
  | { type: 'relinkAsset'; assetId: Id; path: string }
  /** 按精确的字段写入一批实例（格式转换与导入用）。时间已经在帧网格与精确时间上，不再量化。 */
  | { type: 'insertItems'; sequenceId: Id; items: SequenceItemInput[] }
  /** 写入一份文档的新版本。不给 `documentId` 时新建文档。`ref` 供同一事务里后面的操作引用。正文不进快照。 */
  | {
      type: 'putDocument';
      documentId?: Id;
      ref?: string;
      kind: string;
      name?: string;
      language?: string;
      sourceAsset?: { assetId: Id } | { ref: string };
      sourceDocument?: { documentId: Id } | { ref: string };
      body: unknown;
      summary?: unknown;
      extensions?: Record<string, unknown>;
    }
  | {
      type: 'addItem';
      sequenceId: Id;
      asset: { assetId: Id } | { ref: string };
      trackId?: Id;
      at?: TimelineTimeInput;
      alignment: FrameAlignment;
      name?: string;
    }
  | {
      type: 'moveItem';
      sequenceId: Id;
      itemId: Id;
      at?: TimelineTimeInput;
      offset?: TimelineTimeInput;
      trackId?: Id;
      alignment: FrameAlignment;
    }
  | {
      type: 'moveItems';
      sequenceId: Id;
      moves: { itemId: Id; at?: TimelineTimeInput; offset?: TimelineTimeInput; trackId?: Id }[];
      alignment: FrameAlignment;
    }
  | { type: 'trimItem'; sequenceId: Id; itemId: Id; edge: 'start' | 'end'; at: TimelineTimeInput; alignment: FrameAlignment }
  | { type: 'splitItem'; sequenceId: Id; itemId: Id; at: TimelineTimeInput; alignment: FrameAlignment }
  /**
   * 把同一轨道上首尾相接的两个实例合并成一个（拆分的逆）：种类相同；带源时钟的源时间连续、速率相同；其余字段一致，或用
   * `keep`（按 `itemIds` 的先后）指明取哪一边。关键帧与音量包络能还原成同一串帧时拼回，否则算作不一致。留下时间上靠前
   * 的实例，靠后的删掉。
   */
  | { type: 'joinItems'; sequenceId?: Id; itemIds: [Id, Id]; keep?: 'first' | 'second' }
  | { type: 'deleteItems'; sequenceId?: Id; itemIds: Id[] }
  /**
   * 波纹删除（视频格式规范 §6.4）：在 `trackIds` 上删掉序列的 `[from, to)` 并让之后的内容前移补上。盖住区间的媒体实例
   * 拆开删掉中间（经它投影的字幕跟着右段走），静态实例缩短；没列出的轨道不动；轨道或要动的实例锁着时整笔拒绝。
   */
  | { type: 'removeRange'; sequenceId?: Id; from: TimelineTimeInput; to: TimelineTimeInput; trackIds: Id[]; alignment: FrameAlignment }
  /**
   * 在源素材的剪口集合里加入剪口（视频格式规范 §6.7）：`from`、`to` 是源素材时钟上的十进制秒，`ref` 是出处（剪辑建议的 ID）。
   * 与已有剪口间隔不超过 0.02 秒的并成一个，保留靠前那个的 ID 与出处。同一笔事务里按新的保留区间重排剪口集合的实例
   * （它们所在的轨道上波纹删除），其余实例按 `followPolicy` 移动；整个落在剪掉区间里的列在 `impact.removedByCuts`。
   */
  | { type: 'addCuts'; sequenceId: Id; assetId: Id; cuts: { from: string; to: string; ref?: Id }[] }
  /** 恢复一个剪口：从剪口集合里去掉它，在接缝处放回它删掉的源区间、之后的内容后移；找不到接缝时列在 `impact.cutsNotRelaid`。 */
  | { type: 'restoreCut'; sequenceId: Id; assetId: Id; cutId: Id }
  /**
   * 按源素材的转写检测口癖与长停顿，把建议写进它的剪辑提案（视频格式规范 §6.2，没有时新建，有时整份替换）；不改时间线。
   * 已经整个落在剪口里的不再提出。素材有几份转写时用 `speechDocumentId` 指明。
   */
  | { type: 'proposeCuts'; assetId: Id; speechDocumentId?: Id; detect?: CutDetectOptions }
  /**
   * 接受剪辑提案里的建议：编译成剪口（同 `addCuts`，`ref` 是建议的 ID）并标成 `accepted`，一笔事务。转写在提出之后改过时
   * 拒绝（`INVALID_OPERATION`，`details.rule: 'proposal-stale'`）。
   */
  | { type: 'acceptCutSuggestions'; sequenceId: Id; proposalId: Id; suggestionIds: Id[] }
  /** 新增一条轨道，排在最上面。`ref` 供同一事务里后面的 `insertItems` 用 `trackRef` 引用。 */
  | { type: 'addTrack'; sequenceId?: Id; kind: TrackKind; name?: string; ref?: string }
  /**
   * 删掉一条空轨道，其他轨道的 `order` 不变。轨道上还有片段时拒绝（`INVALID_OPERATION`，`details.rule: 'track-not-empty'`，
   * `details.itemIds` 与 `details.next: ['deleteItems', 'moveItem']`）；被闪避规则引用时也拒绝（`track-in-ducking`）。
   */
  | { type: 'deleteTrack'; sequenceId?: Id; trackId: Id }
  | { type: 'updateTrack'; sequenceId?: Id; trackId: Id; locked?: boolean; visible?: boolean; muted?: boolean; name?: string }
  /**
   * 调整一个画面实例的叠放次序（画布上的「前移一层 / 后移一层 / 移到最前 / 移到最后」）。叠放次序就是轨道的上下：
   * 实例与别的实例共用一条轨道时，把它拆到相邻新建的一条轨道上（新轨道列在 `createdIds`，让位的轨道列在 `updatedIds`）；
   * 它独占一条轨道时，整条轨道在同类轨道里挪位（相邻两条互换，或挪到最上 / 最下，其余顺次让位）。已经在最前 / 最后时拒绝
   * （`INVALID_OPERATION`，`details.rule: 'already-at-edge'`）；实例或所在轨道锁着时 `TARGET_LOCKED`。
   */
  | { type: 'arrangeItem'; sequenceId?: Id; itemId: Id; direction: ArrangeDirection }
  /**
   * 把一条轨道挪到同类的另一条轨道（`target`）上面或下面：同类轨道原有的那组 `order` 值按新次序重新分配，别的种类不动，
   * 实例跟着轨道走。种类不同或参照自己时拒绝（`INVALID_OPERATION`）；轨道锁着时 `TARGET_LOCKED`。
   */
  | { type: 'moveTrack'; sequenceId?: Id; trackId: Id; target: Id; position: 'above' | 'below' }
  /**
   * 片段的名字、启用、锁定与跟随策略。空名字清掉名字；锁定的片段只能先解锁（同一个操作里解锁再改别的可以）。
   * `followPolicy` 整个替换（视频格式规范 §3.16）。
   */
  | { type: 'updateItem'; sequenceId?: Id; itemId: Id; name?: string; enabled?: boolean; locked?: boolean; followPolicy?: FollowPolicy }
  /** 改画面实例的位置（`place`）：只改给出的字段；数值给 `null` 去掉，回到按种类的缺省。字幕与音频没有位置。 */
  | {
      type: 'setTransform';
      sequenceId?: Id;
      itemId: Id;
      x?: number | null;
      y?: number | null;
      w?: number | null;
      scale?: number | null;
      scaleY?: number | null;
      rot?: number | null;
      flipX?: boolean;
      flipY?: boolean;
    }
  /**
   * 改画面实例的外观：只改给出的字段，给 `null` 去掉（回到缺省）。`opacity`、`radius`、`cornerRadii` 写进 `place`；
   * `mode`、`fit`、`bg`、`mask` 是视觉媒体的；`tile` 用于图片与文字；`style`、`stylePresetId`、`verticalAlign` 用于文字；
   * `shape` 整个替换图形的参数；`crop` 用于视频与图片。适用范围与取值由引擎按元素模型校验。
   */
  | {
      type: 'setStyle';
      sequenceId?: Id;
      itemId: Id;
      opacity?: number | null;
      radius?: number | null;
      cornerRadii?: CornerRadii | null;
      mode?: VisualMode | null;
      fit?: FitMode | null;
      bg?: MediaBackground | null;
      mask?: Mask | null;
      tile?: Tile | null;
      style?: Record<string, unknown> | null;
      stylePresetId?: string | null;
      verticalAlign?: 'top' | 'center' | 'bottom' | null;
      shape?: ShapeProps;
      /** 视频与图片的裁剪；`null` 去掉。 */
      crop?: Crop | null;
    }
  /** 改文字实例的内容：`text` 与 `counter` 给且只给一个，给了的那个替换另一个。 */
  | { type: 'setText'; sequenceId?: Id; itemId: Id; text?: string; counter?: CounterProps }
  /**
   * 整个替换生成类元素与图形的种类参数（`shape`、`sticker`、`visualizer`、`progress`、`draw`、`placeholder`、`confetti`、
   * `whiteboard` 里与实例种类相同的那一个）。
   */
  | { type: 'setProps'; sequenceId?: Id; itemId: Id; props: Record<string, unknown> }
  /** 整个替换画面实例的元素动画三槽；`null` 去掉。 */
  | { type: 'setAnimation'; sequenceId?: Id; itemId: Id; animate: Animation | null }
  /** 整个替换画面实例一个属性的关键帧；`null` 或空表去掉这条绑定。 */
  | { type: 'setKeyframes'; sequenceId?: Id; itemId: Id; property: KeyframeProperty; keyframes: Keyframe[] | null }
  /** 整个替换序列的模板层；`null` 去掉。 */
  | { type: 'setTemplate'; sequenceId: Id; template: TemplateLayers | null }
  /** 改合成实例的参数：`values` 整体替换 `parameterValues`。代码包的参数要先按它的 Schema 校验，引擎还不支持，拒绝。 */
  | { type: 'setCodeParameters'; sequenceId?: Id; itemId: Id; values: Record<string, unknown> }
  /**
   * 原地换合成实例的代码包版本与预渲染替身（代码包规范 §3.3）：实例 ID、轨道、起点、几何、效果、关键帧等都不变。
   * 时间映射回到从 0 开始的线性映射；长度取新替身的长度，没有替身时取清单的 `intrinsic`。变短就裁掉，
   * 变长撞上同轨后面的实例以 `TIMELINE_OVERLAP` 拒绝。实例有参数而新包去掉或换了 `parametersSchemaRef` 时要给 `parameterValues`。
   * 回执的 `impact.codeEdits` 说明改的是源这一层与前后的长度。
   */
  | {
      type: 'replaceCodeBundle';
      sequenceId?: Id;
      itemId: Id;
      assetRef: VersionRef;
      prerender?: VersionRef | null;
      parameterValues?: Record<string, unknown>;
    }
  /**
   * 改声音：音频实例改自己的混音；视频与有声音的合成改自带的那路声音（静音即不用它）。
   * 音量是线性倍数，在 [0, 4]；淡入淡出是十进制秒，`"0"` 表示去掉，两者之和不超过片段长度。
   */
  | { type: 'setAudioMix'; sequenceId?: Id; itemId: Id; muted?: boolean; volume?: number; fadeIn?: string; fadeOut?: string }
  /**
   * 恒定速率变速（视频、音频）：取用的源区间不变，长度按新速率重算——视频向下取整到帧，音频保持精确。
   * 速率在 0.1–10 之间，须约分。变长之后盖住后面的实例就拒绝，不推开别人。
   */
  | { type: 'setSpeed'; sequenceId?: Id; itemId: Id; rate: Rate }
  /** 字幕实例换一份字幕样式文档（`kind` 为 `caption-style`）。 */
  | { type: 'setCaptionStyle'; sequenceId?: Id; itemId: Id; styleDocument: { documentId: Id } | { ref: string } }
  /** 序列的名字、画布尺寸（像素）与底色（`#RRGGBB`）。位置按画幅的百分比保存，改尺寸时实例跟着画布走。 */
  | {
      type: 'updateSequence';
      sequenceId: Id;
      name?: string;
      canvas?: { width: number; height: number };
      background?: string;
    }
  /**
   * 设置一个转场：两个首尾相接的同轨画面实例之间（两个 ID 都给），或一个实例的开头（只给 `rightItemId`）、结尾（只给
   * `leftItemId`）。同一条边上已有的转场被替换（同一对实例沿用原来的 ID）。时长量化到帧：两侧转场必须给，不超过 10 秒，
   * handles 不够时拒绝（`TRANSITION_HANDLES_INSUFFICIENT`），不自动缩短；单侧转场在 0.1–2 秒，不给时 0.5 秒，生效的长度
   * 随实例变短。给了 `duration` 就要写明 `alignment`。单侧转场只能居中，不能交叉淡化声音。
   */
  | {
      type: 'setTransition';
      sequenceId: Id;
      leftItemId?: Id;
      rightItemId?: Id;
      kind: TransitionKind;
      params?: Record<string, unknown>;
      duration?: TimelineTimeInput;
      alignment?: FrameAlignment;
      easing?: Easing;
      placement?: TransitionPlacement;
      audioCrossfade?: boolean;
    }
  | { type: 'removeTransition'; sequenceId?: Id; transitionId: Id }
  /** 整个替换视觉媒体（视频、图片、素材贴纸、占位框、白板）或合成实例的 `fx`；`null` 去掉。 */
  | { type: 'setEffects'; sequenceId?: Id; itemId: Id; fx: Fx | null }
  /** 整个替换序列的章节（其他标记不动）：按时间严格递增；`chapterId` 沿用已有的章节。 */
  | {
      type: 'setChapters';
      sequenceId: Id;
      chapters: { chapterId?: Id; at: TimelineTimeInput; title: string; summary?: string; thumbnail?: AssetRefInput }[];
      alignment: FrameAlignment;
    }
  /** 新建（不给 `chapterId`，须给 `at` 与 `title`）或修改一章。给 `at` 时要写明 `alignment`；`summary`、`thumbnail` 给 null 去掉。 */
  | {
      type: 'upsertChapter';
      sequenceId: Id;
      chapterId?: Id;
      at?: TimelineTimeInput;
      alignment?: FrameAlignment;
      title?: string;
      summary?: string | null;
      thumbnail?: AssetRefInput | null;
    }
  | { type: 'removeChapter'; sequenceId?: Id; chapterId: Id }
  /**
   * 新建（不给 `ruleId`，须给 `trigger` 与 `target`）或修改一条闪避规则。`depth` 在 [0, 60] dB，默认 10；
   * `attack`、`release` 是十进制秒（0–5）。按实例触发时，触发组与目标组不能重叠。
   */
  | {
      type: 'setDucking';
      sequenceId: Id;
      ruleId?: Id;
      name?: string;
      enabled?: boolean;
      /** 除了已有的轨道与实例，还可以用同一事务里 `addTrack` 的 `ref`（`trackRefs`）。 */
      trigger?: DuckingTriggerInput;
      target?: DuckingGroupInput;
      depth?: number;
      attack?: string;
      release?: string;
    }
  | { type: 'removeDucking'; sequenceId?: Id; ruleId: Id }
  | { type: 'createCheckpoint'; name: string; note?: string }
  | { type: 'renameVideo'; name: string };

/** 引用素材：已有素材的 ID，或同一事务里 `importAsset` 的 `ref`。 */
export type AssetRefInput = { assetId: Id } | { ref: string };

export type EditOperationType = EditOperation['type'];

// ---- 回执、事件、历史 ----

export interface Actor {
  kind: 'user' | 'agent' | 'system';
  id: Id;
}

export interface TimeQuantizationReceipt {
  domain: { kind: 'sequence'; sequenceId: Id };
  sequenceRevision: Revision;
  editFps: Rate;
  requested: TimelineTimeInput;
  requestedTime: MediaTime;
  actualFrame: number;
  actualTime: MediaTime;
  delta: MediaTime;
  policy: FrameAlignment;
}

/** 事务持久化之后的回执（命令与协议规范 §5）。界面在收到它之前不显示「已保存」。 */
/** 代码画面的一次修改（代码包规范 §3.4）。`layer` 目前只有 `source`：换的是代码包版本与替身。 */
export interface CodeEdit {
  itemId: Id;
  layer: 'source';
  previousBundleRef: VersionRef;
  bundleRef: VersionRef;
  previousPrerender: VersionRef | null;
  prerender: VersionRef | null;
  oldDurationFrames: number;
  newDurationFrames: number;
}

export interface TransactionReceipt {
  transactionId: Id;
  commandId: Id;
  status: 'committed';
  videoId: Id;
  previousRevision: Revision;
  videoRevision: Revision;
  eventSeq: Seq;
  label: string;
  actor: Actor;
  undoOf?: Id;
  createdIds: Id[];
  updatedIds: Id[];
  deletedIds: Id[];
  lineage: Record<Id, Id[]>;
  /** 操作里的 `ref` 解析到的素材、文档或轨道 ID。空的时候省略。 */
  refs?: Record<string, Id>;
  impact: {
    oldDurationFrames: number;
    newDurationFrames: number;
    translationUnitsStale: Id[];
    dubbingUnitsStale: Id[];
    /**
     * 这笔事务之后语义锚（`speech-anchor`）求不出来、或者摆不到求出的位置上的实例：它们留在原来的位置（视频格式规范 §3.16）。
     * 原因由 `videos.inspect` 的 `orphanedAnchors` 按时间线现算。
     */
    orphanedAnchors: Id[];
    /** 这次编辑之后不再成立、被引擎删掉的转场。空的时候省略。 */
    removedTransitions?: { id: Id; reason: TransitionRemovalReason }[];
    /** 这笔事务里因为实例变短而变短的单侧转场：写入的长度与生效的长度 min(D, ⌊L/2⌋)。空的时候省略。 */
    shortenedTransitions?: { id: Id; durationFrames: number; effectiveFrames: number }[];
    /** 随剪口删掉的实例：整个落在剪掉的区间里。它们同时在 `deletedIds` 里。空的时候省略。 */
    removedByCuts?: Id[];
    /** 恢复了、却在序列上找不到接缝放回去的剪口：剪口集合里已经去掉，实例没有动。空的时候省略。 */
    cutsNotRelaid?: Id[];
    /** 跟着的目标（`item-local`）被删掉、一起删掉的实例（视频格式规范 §3.16）。它们同时在 `deletedIds` 里。空的时候省略。 */
    removedWithTarget?: Id[];
    /** 这笔事务改过的代码画面（代码包规范 §3.4）：改在哪一层，前后的代码包版本、替身与长度。空的时候省略。 */
    codeEdits?: CodeEdit[];
    /** `deleteTrack` 删掉的空轨道。它们同时在 `deletedIds` 里。空的时候省略。 */
    removedTracks?: Id[];
    /** `removeAssets` 删掉的素材记录，含成对一起删掉的代码包或预渲染替身。它们同时在 `deletedIds` 里。空的时候省略。 */
    removedAssets?: Id[];
  };
  timeResolution: TimeQuantizationReceipt[];
  preserved: Id[];
  /** `unavailableReason` 是引擎给的英文缺省文字，`unavailableReasonRef` 是它的消息引用（界面用 `localizeText` 按当前语言显示）。 */
  undo: { available: boolean; token?: string; unavailableReason?: string; unavailableReasonRef?: MessageRef };
  committedAt: string;
}

/** 转场被删掉的原因：实例没了、两侧不再相接、窗口超出实例、handles 不够、与同一实例上的另一个转场重叠。 */
export type TransitionRemovalReason = 'item-deleted' | 'not-adjacent' | 'too-long' | 'handles-insufficient' | 'overlap';

export type VideoEntityKind =
  'video' | 'sequence' | 'track' | 'item' | 'transition' | 'marker' | 'ducking' | 'asset' | 'document' | 'checkpoint' | 'protection';

/** 视频事件（命令与协议规范 §10.1）：一笔事务一条，带着可以直接应用的投影变化。 */
export interface VideoEvent {
  videoId: Id;
  /** 视频自己的事件序号（outbox）。与主题的投递序号不是一回事。 */
  eventSeq: Seq;
  videoRevision: Revision;
  transactionId: Id;
  changedIds: Id[];
  projection: {
    upserts: { kind: VideoEntityKind; id: Id; sequenceId?: Id; value: unknown }[];
    removals: { kind: VideoEntityKind; id: Id; sequenceId?: Id }[];
  };
  actor: Actor;
  label: string;
  undoOf?: Id;
  taskId?: Id;
}

export interface HistoryEntry {
  transactionId: Id;
  commandId: Id;
  label: string;
  actor: Actor;
  videoRevision: Revision;
  committedAt: string;
  undoOf?: Id;
  undoneBy?: Id;
  /** 0 是正向修改，奇数是撤销，正偶数是重做。 */
  undoDepth: number;
  undoAvailable: boolean;
}

export interface UndoStep {
  transactionId: Id;
  label: string;
}

/** 当前连接的操作者可以撤销与重做的一步（只含自己的修改）。 */
export interface UndoState {
  undo?: UndoStep;
  redo?: UndoStep;
}

export type UndoTarget = 'undo' | 'redo' | { transaction: Id };

/**
 * 引擎的错误体（命令与协议规范 §11），放在 `RpcError.details` 里。
 * `code` 是规范里的错误码，例如 `PROJECT_REVISION_CONFLICT`、`TIMELINE_OVERLAP`。
 */
export interface EngineErrorBody {
  code: string;
  message: string;
  entityIds: Id[];
  inputRevisions: VersionRef[];
  retryability: 'same-command' | 'after-refresh' | 'after-user-action' | 'never';
  details: unknown;
  recovery?: string;
  /** `message` 的消息引用（命令与协议规范 §11.1）：`message` 与 `recovery` 是英文缺省文字，界面用 `localizeText(message, messageRef)` 按当前语言显示。 */
  messageRef?: MessageRef;
  recoveryRef?: MessageRef;
}

export function isEngineErrorBody(value: unknown): value is EngineErrorBody {
  return typeof value === 'object' && value !== null && typeof (value as EngineErrorBody).code === 'string' && 'retryability' in value;
}

// ---- 主题 ----

/** 已打开视频的位置与身份。 */
export interface VideoRef {
  videoId: Id;
  name: string;
  /** 视频目录的绝对路径。 */
  path: string;
  /** 所在的来源：项目，或不属于项目的会话的工作目录。 */
  source: { projectId: Id | null; conversationId: Id | null };
  /** 相对来源目录的路径，用 `/` 分隔。 */
  relPath: string;
}

export interface VideoTopicSnapshot {
  video: VideoSnapshot;
  /** 快照所在的视频事件序号。 */
  eventSeq: Seq;
}

/**
 * `video:<id>` 主题的事件。`video.replaced` 在引擎进程重启、无法证明增量连续时整体替换；
 * `video.closed` 表示视频在 Runtime 里关闭了，界面要重新打开它。
 */
export type VideoTopicEvent =
  | { type: 'video.event'; event: VideoEvent }
  | { type: 'video.replaced'; snapshot: VideoTopicSnapshot }
  | { type: 'video.closed'; reason: string };

// ---- 共享的投影 reducer：Runtime 的镜像与界面用同一个 ----

function itemStart(item: SequenceItem, fps: Rate): number {
  if (item.type === 'audio') return (item.fromFrame * fps.den) / fps.num + mediaTimeToSeconds(item.subframeOffset);
  return (item.span.fromFrame * fps.den) / fps.num;
}

function sortItems(items: SequenceItem[], tracks: Track[], fps: Rate): SequenceItem[] {
  const order = new Map(tracks.map((t) => [t.id, t.order]));
  return [...items].sort(
    (a, b) =>
      (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0) ||
      itemStart(a, fps) - itemStart(b, fps) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function compareIds(a: Id, b: Id): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * 把一条视频事件应用到快照上，返回新快照（不修改输入）。序号不大于快照的事件原样返回（重复投递）。
 */
export function applyVideoEvent(state: VideoTopicSnapshot, event: VideoEvent): VideoTopicSnapshot {
  if (BigInt(event.eventSeq) <= BigInt(state.eventSeq)) return state;
  const video: VideoSnapshot = {
    ...state.video,
    sequences: { ...state.video.sequences },
    assets: { ...state.video.assets },
    documents: { ...state.video.documents },
    checkpoints: { ...state.video.checkpoints },
    protections: { ...state.video.protections },
  };
  const touched = new Set<Id>();
  const sequenceOf = (id: Id | undefined): Sequence | undefined => {
    if (!id) return undefined;
    const seq = video.sequences[id];
    if (!seq) return undefined;
    if (!touched.has(id)) {
      touched.add(id);
      video.sequences[id] = {
        ...seq,
        tracks: [...seq.tracks],
        items: [...seq.items],
        transitions: [...seq.transitions],
        markers: [...seq.markers],
        ducking: [...seq.ducking],
      };
    }
    return video.sequences[id];
  };

  for (const removal of event.projection.removals) {
    switch (removal.kind) {
      case 'item': {
        const seq = sequenceOf(removal.sequenceId);
        if (seq) seq.items = seq.items.filter((i) => i.id !== removal.id);
        break;
      }
      case 'track': {
        const seq = sequenceOf(removal.sequenceId);
        if (seq) seq.tracks = seq.tracks.filter((t) => t.id !== removal.id);
        break;
      }
      case 'transition': {
        const seq = sequenceOf(removal.sequenceId);
        if (seq) seq.transitions = seq.transitions.filter((t) => t.id !== removal.id);
        break;
      }
      case 'marker': {
        const seq = sequenceOf(removal.sequenceId);
        if (seq) seq.markers = seq.markers.filter((m) => m.id !== removal.id);
        break;
      }
      case 'ducking': {
        const seq = sequenceOf(removal.sequenceId);
        if (seq) seq.ducking = seq.ducking.filter((r) => r.id !== removal.id);
        break;
      }
      case 'sequence':
        delete video.sequences[removal.id];
        break;
      case 'asset':
        delete video.assets[removal.id];
        break;
      case 'document':
        delete video.documents[removal.id];
        break;
      case 'checkpoint':
        delete video.checkpoints[removal.id];
        break;
      case 'protection':
        delete video.protections[removal.id];
        break;
      case 'video':
        break;
    }
  }

  for (const upsert of event.projection.upserts) {
    switch (upsert.kind) {
      case 'video': {
        const value = upsert.value as { name: string; rootSequenceId: Id };
        video.name = value.name;
        video.rootSequenceId = value.rootSequenceId;
        break;
      }
      case 'sequence': {
        const header = upsert.value as Omit<Sequence, 'tracks' | 'items' | 'transitions' | 'markers' | 'ducking'>;
        const existing = sequenceOf(upsert.id);
        if (existing) {
          Object.assign(existing, header);
          // 没有模板层时省略：去掉之后的投影里也不能留着旧的。
          if (!('template' in header)) delete existing.template;
        } else {
          video.sequences[upsert.id] = {
            transitions: [],
            markers: [],
            ducking: [],
            tracks: [],
            items: [],
            ...header,
            id: upsert.id,
          };
          touched.add(upsert.id);
        }
        break;
      }
      case 'track': {
        const seq = sequenceOf(upsert.sequenceId);
        const track = upsert.value as Track;
        if (seq) seq.tracks = [...seq.tracks.filter((t) => t.id !== track.id), track];
        break;
      }
      case 'item': {
        const seq = sequenceOf(upsert.sequenceId);
        const item = upsert.value as SequenceItem;
        if (seq) seq.items = [...seq.items.filter((i) => i.id !== item.id), item];
        break;
      }
      case 'transition': {
        const seq = sequenceOf(upsert.sequenceId);
        const transition = upsert.value as Transition;
        if (seq) seq.transitions = [...seq.transitions.filter((t) => t.id !== transition.id), transition];
        break;
      }
      case 'marker': {
        const seq = sequenceOf(upsert.sequenceId);
        const marker = upsert.value as Marker;
        if (seq) seq.markers = [...seq.markers.filter((m) => m.id !== marker.id), marker];
        break;
      }
      case 'ducking': {
        const seq = sequenceOf(upsert.sequenceId);
        const rule = upsert.value as DuckingRule;
        if (seq) seq.ducking = [...seq.ducking.filter((r) => r.id !== rule.id), rule];
        break;
      }
      case 'asset':
        video.assets[upsert.id] = upsert.value as AssetRecord;
        break;
      case 'document':
        video.documents[upsert.id] = upsert.value as DocumentRecord;
        break;
      case 'checkpoint':
        video.checkpoints[upsert.id] = upsert.value as Checkpoint;
        break;
      case 'protection':
        video.protections[upsert.id] = upsert.value;
        break;
    }
  }

  for (const id of touched) {
    const seq = video.sequences[id];
    if (!seq) continue;
    seq.tracks = sortTracks(seq.tracks);
    seq.items = sortItems(seq.items, seq.tracks, seq.fps);
    seq.transitions = [...seq.transitions].sort((a, b) => compareIds(a.id, b.id));
    seq.markers = [...seq.markers].sort((a, b) => a.frame - b.frame || compareIds(a.id, b.id));
    seq.ducking = [...seq.ducking].sort((a, b) => compareIds(a.id, b.id));
  }
  video.revision = event.videoRevision;
  return { video, eventSeq: event.eventSeq };
}

// ---- 显示用的时间换算（只用于显示与命中测试；命令里用帧或十进制秒字符串）----

export function mediaTimeToSeconds(time: MediaTime): number {
  return Number(time.ticks) / time.timescale;
}

export function framesToSeconds(frames: number, fps: Rate): number {
  return (frames * fps.den) / fps.num;
}

export function secondsToFrames(seconds: number, fps: Rate): number {
  return (seconds * fps.num) / fps.den;
}

/** 实例在序列上的区间（秒）。 */
export function itemRangeSeconds(item: SequenceItem, fps: Rate): { start: number; end: number } {
  if (item.type === 'audio') {
    const start = itemStart(item, fps);
    return { start, end: start + mediaTimeToSeconds(item.playDuration) };
  }
  return { start: framesToSeconds(item.span.fromFrame, fps), end: framesToSeconds(item.span.fromFrame + item.span.durationFrames, fps) };
}

/** 序列长度（帧）：所有实例终点的最大值向上取整。 */
export function sequenceDurationFrames(sequence: Sequence): number {
  let max = 0;
  for (const item of sequence.items) {
    if (item.type === 'audio')
      max = Math.max(max, Math.ceil(secondsToFrames(itemRangeSeconds(item, sequence.fps).end, sequence.fps) - 1e-9));
    else max = Math.max(max, item.span.fromFrame + item.span.durationFrames);
  }
  return max;
}

/**
 * 视频的封面取的那一帧（产品设计 §4.2「封面取当前工作稿」）：根序列上最早出现、启用着、轨道可见、素材有画面的视频片段，
 * 在它开头对应的素材时间（秒）。会话头的视频卡与 Space 的缩略图（`space.thumbnail`）取的是同一帧。没有这样的片段时为 null。
 */
export function posterFrame(video: VideoSnapshot): { asset: VersionRef; at: number } | null {
  const sequence = video.sequences[video.rootSequenceId];
  if (!sequence) return null;
  const visible = new Set(sequence.tracks.filter((track) => track.visible).map((track) => track.id));
  let best: { from: number; asset: VersionRef; at: number } | null = null;
  for (const item of sequence.items) {
    if (item.type !== 'video' || !item.enabled || !visible.has(item.trackId)) continue;
    if (!video.assets[item.assetRef.id]?.revisions[item.assetRef.revision]?.video) continue;
    if (best && best.from <= item.span.fromFrame) continue;
    const at = item.timeMap.kind === 'hold' ? mediaTimeToSeconds(item.timeMap.sourceAt) : mediaTimeToSeconds(item.timeMap.sourceIn);
    best = { from: item.span.fromFrame, asset: item.assetRef, at };
  }
  return best ? { asset: best.asset, at: best.at } : null;
}
