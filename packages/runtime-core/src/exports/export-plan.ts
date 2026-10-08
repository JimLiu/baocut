import type { Id } from '@baocut/protocol';

/**
 * 引擎 `exports.plan` 的结果（`crates/engine-host/src/exports.rs`）：一次请求、同一个视频版本里的计划。
 * 时间都是秒，相对各段范围的起点；时间线的换算（剪切、变速、作用实例）全在引擎里做完，这里不重算。
 */

export interface PlanRange {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface AudioFade {
  start: number;
  end: number;
}

/** 转场的声音交叉淡化（等功率）：出场一侧乘 cos(p·π/2)，入场一侧乘 sin(p·π/2)，p 在 `[start, end)` 里线性走过 0→1。 */
export interface AudioCrossfade {
  transitionId: Id;
  role: 'outgoing' | 'incoming';
  start: number;
  end: number;
}

export interface AudioSegment {
  itemId: Id;
  source: 'embedded' | 'audio';
  asset: { id: Id; revision: string };
  trackOrder: number;
  start: number;
  end: number;
  sourceStart: number;
  sourceRate: number;
  /** 实例的固定增益（不含淡变）。有音量包络时是 0：音量在 `envelope` 里。 */
  gainDb: number;
  /**
   * 音量包络（视频格式规范 §3.9）烘焙成的折点 `[秒, 线性倍数]`：折点之间线性，第一个之前取第一个的值，最后一个之后
   * 保持最后的值；与预览的逐帧计划同一条折线。没有包络时省略。
   */
  envelope?: Array<[number, number]>;
  fadeIn?: AudioFade;
  fadeOut?: AudioFade;
  /** 这一段所在的转场交叉淡化。 */
  crossfades?: AudioCrossfade[];
  /**
   * 闪避压低量的折点 `[秒, dB]`：折点之间线性，第一个之前是 0，最后一个之后保持最后的值；同一时刻两个折点是台阶
   * （到了那一刻取后一个）。压低量从增益里减去。
   */
  ducking?: Array<[number, number]>;
  /** 交叉淡化时在实例自己的区间之外取 handles 的一段（不套实例的淡入淡出）。 */
  handle?: boolean;
}

export interface AudioPlan {
  sequenceId: Id;
  sequenceRevision: string;
  range: PlanRange;
  segments: AudioSegment[];
  /** 计划没有照做或与预览不同的：`DUCK_NO_SPEECH`、`HOLD_IS_SILENT`、`ASSET_HAS_NO_AUDIO`、`CROSSFADE_HANDLE_SHORT`。 */
  notes: Array<{ code: string; itemId: Id }>;
}

export interface TextEntry {
  /** `<作用实例>:<id>`，同一个词被裁成几段时后面的加 `#n`。 */
  key: string;
  id: string;
  scopeItemId?: Id;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  sentenceId?: string;
  paragraphStart?: boolean;
  /** 词时间可信（对齐过或服务商给的）；字幕条与插值、缺失的词为 false。 */
  wordTiming: boolean;
  clipped?: boolean;
}

export interface TextPlan {
  sequenceId: Id;
  documentId: Id;
  /** `caption`：一条是一条字幕；`speech`：一条是一个词。 */
  unit: 'caption' | 'speech';
  clock: string;
  scope: { basis: string; captionItemIds: Id[]; scopeItemIds: Id[] };
  range: PlanRange;
  entries: TextEntry[];
  sourceCount: number;
  omittedCount: number;
}

export interface PlannedAsset {
  assetId: Id;
  revision: string;
  name: string;
  path: string;
  storage: 'managed' | 'linked';
  mediaType: string;
  contentHash: string;
  byteLength: number;
  modifiedAt: string | null;
  audio: { sampleRate: number; channels: number; layout?: string } | null;
}

export interface PlannedDocument {
  documentId: Id;
  kind: string;
  name: string;
  language: string | null;
  revision: string;
  sourceAssetId: Id | null;
  sourceDocumentId: Id | null;
  schema: string;
  /** 译文与转写的正文（句子的成员、说话人的名字、译句）；字幕为 null。 */
  body: unknown;
}

interface PlanCommon {
  videoId: Id;
  videoName: string;
  videoRevision: string;
  sequenceId: Id;
  sequenceRevision: string;
  fps: { num: number; den: number };
  canvas: { width: number; height: number };
}

export interface AudioPlanResult extends PlanCommon {
  parts: Array<{ audio: AudioPlan }>;
  assets: PlannedAsset[];
}

export interface TextPlanResult extends PlanCommon {
  documents: PlannedDocument[];
  /** 每段范围一份；`plans[i]` 对应 `documents[i]`，译文为 null。 */
  parts: Array<{ plans: Array<TextPlan | null> }>;
  style: { documentId: Id; revision: string; body: unknown } | null;
}
