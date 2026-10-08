import type { Easing, Id, Revision, VersionRef } from '@baocut/protocol';

/**
 * 帧计划（架构设计 §9.1）：Rust `render-graph` 的输出，经 WASM 交给界面。字段与 `crates/render-graph` 的
 * serde 输出一一对应；计划只说「画什么、画在哪」，像素由合成器按它去画。
 */
export interface FramePlan {
  sequenceId: Id;
  sequenceRevision: Revision;
  /** 这一刻所在的视频帧（向下取整）。 */
  frame: number;
  canvas: PlanCanvas;
  /** 按合成顺序：先画的在下面。 */
  layers: VisualLayer[];
  voices: AudioVoice[];
}

export interface PlanCanvas {
  width: number;
  height: number;
  background: string;
  backgroundAlpha: number;
}

type Matrix = [number, number, number, number, number, number];

/**
 * 一个画面层。`matrix` 把单位正方形映到画布像素，即 Canvas 2D 的 `setTransform(a, b, c, d, e, f)`：
 * 视频与图片把源画面的 `sourceRect`（相对显示尺寸归一化的 `[u0, v0, u1, v1]`）画进单位正方形；
 * 文字、图形、生成器与不支持的层的单位正方形是实例的布局框（已含翻转）；字幕的单位正方形是整张画布。
 */
export type VisualLayer = MediaLayer | TextLayer | ShapeLayer | GeneratorLayer | CaptionLayer | UnsupportedLayer;

interface LayerBase {
  /** 出这一层的实例。 */
  itemId: Id;
  matrix: Matrix;
  opacity: number;
  /** 启用的效果，按作用顺序（格式规范 §3.9）；没有时省略。认不出的种类带 `unsupported`，跳过并报出来。 */
  effects?: LayerEffect[];
  /** 这一刻这一层在转场里（格式规范 §3.9）。 */
  transition?: LayerTransition;
}

export interface LayerEffect {
  id: Id;
  kind: string;
  /** 空的时候省略。 */
  params?: Record<string, unknown>;
  /** 画不出来的原因：`unknown-kind`、`reserved`（如 `lut`）、`invalid-params`。 */
  unsupported?: string;
}

/**
 * 层所在的转场。`progress` 是这一刻在窗口里的位置（0–1），`eased` 是缓动之后的值，画法都按 `eased`。
 * 两侧转场的另一侧在 `partner` 里（它在自己的区间之外，源时刻在 handles 里）；单侧转场没有 `partner`，另一侧是透明。
 */
export interface LayerTransition {
  id: Id;
  kind: string;
  params?: Record<string, unknown>;
  easing: Easing;
  progress: number;
  eased: number;
  /** 这一层是出场的一侧还是入场的一侧。 */
  role: 'outgoing' | 'incoming';
  partner?: VisualLayer;
  /** 认不出的种类：按硬切画（只画这一层）并报出来。 */
  unsupported?: string;
}

export interface MediaLayer extends LayerBase {
  /** `video` 层不一定来自视频实例：带预渲染替身的合成也按视频层给出，`asset` 是替身。 */
  kind: 'video' | 'image';
  /** 这一层取画面的素材。要用哪个素材只看这里，不从实例上推。 */
  asset: VersionRef;
  /** 视频要取的源时刻（秒）；图片没有。 */
  sourceSeconds?: number;
  /** 源时间相对序列时间的速度；定格是 0。图片没有。 */
  sourceRate?: number;
  sourceRect: [number, number, number, number];
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  /** 文字实例的样式对象（与字幕样式同一套字段）。 */
  content: { text: string; style: Record<string, unknown> };
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  content: { shape: Record<string, unknown> };
}

/** 内置生成器按局部时刻画出来的画面。 */
export interface GeneratorLayer extends LayerBase {
  kind: 'generator';
  /** 合成的局部时刻（经过它的时间映射）与速度。 */
  sourceSeconds: number;
  sourceRate: number;
  content: {
    generator: string;
    version: number;
    parameters: Record<string, unknown>;
    /** 这一刻离实例开始过了多久、实例一共多长（序列时间，秒）。 */
    elapsedSeconds: number;
    durationSeconds: number;
  };
}

export interface CaptionLayer extends LayerBase {
  kind: 'caption';
  content: {
    /** 字幕实例跟随文档的当前版本。 */
    documentId: Id;
    styleDocumentId?: Id;
    /** 这一刻的序列时间：文档在序列时钟上时按它找句子。 */
    sequenceSeconds: number;
    /** 文档在源素材时钟上时，这一刻经过哪个作用实例、落在它的源的哪一刻。 */
    scope?: { itemId: Id; asset: VersionRef; sourceSeconds: number };
  };
}

/** 该有画面但计划给不出画法（没有预渲染替身的代码包合成、手绘、占位框、白板、素材贴纸、模板层）：要明确报出来，不画成空白。 */
export interface UnsupportedLayer extends LayerBase {
  kind: 'unsupported';
  asset?: VersionRef;
  content: { reason: string };
}

export function isMediaLayer(layer: VisualLayer): layer is MediaLayer {
  return layer.kind === 'video' || layer.kind === 'image';
}

/** 画进自己布局框的层：文字、图形、生成器与不支持的层。 */
export type BoxLayer = TextLayer | ShapeLayer | GeneratorLayer | UnsupportedLayer;

export interface AudioVoice {
  itemId: Id;
  /** `embedded`：视频实例（或带预渲染替身的合成）自带的声音，`asset` 是出声的视频素材；`audio`：音频轨道上的实例。 */
  source: 'embedded' | 'audio';
  asset: VersionRef;
  sourceSeconds: number;
  sourceRate: number;
  /** 这一刻的增益：实例的增益、淡入淡出、转场的声音交叉淡化与闪避都已算进去。 */
  gainDb: number;
  /** 闪避正在压低这个声音时，压低之前的增益。没有被压低时省略。 */
  unduckedGainDb?: number;
  /** 转场的声音交叉淡化里的声音（两侧都带同一个转场 ID）。 */
  transitionId?: Id;
}

export interface PlanErrorBody {
  code: string;
  message: string;
}
