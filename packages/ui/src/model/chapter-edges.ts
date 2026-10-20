import { framesToSeconds, secondsToFrames, type Rate } from '@baocut/protocol';
import type { ChapterSpan } from './chapters.ts';
import type { LiteSegment } from './lite-segments.ts';

/**
 * 拖章节边界的纯规则：时间线的章节条（拖一章的起点）与轻量视图的片条（拖一片的右边，就是下一章的起点）共用。
 * 两处挪的都是同一个东西——某一章的起点帧——提交也是同一笔 `upsertChapter`（`moveChapterOperation`，`chapters.ts`）；
 * 差别只在两边各留多少：章节条留 1 帧（引擎只拒同一帧），片条按轻量编辑器设计 §3.2 两边各留 1 秒。
 */

export interface FrameBounds {
  min: number;
  max: number;
}

/** 片条上拖章节边界时，两边各至少留这么多秒（轻量编辑器设计 §3.2）。 */
export const CHIP_EDGE_MIN_SECONDS = 1;

/**
 * 一章的起点能挪到哪些帧：上一章的起点之后、下一章的起点之前、片尾之前，各留 `gap` 帧；第一章最早到 0。
 * 两章挤得放不下时 `min > max`，原样返回，由调用方决定（`startBounds` 收成一点，片条不给把手）。
 */
export function edgeBounds(chapters: readonly ChapterSpan[], index: number, totalFrames: number, gap = 1): FrameBounds {
  const keep = Math.max(1, Math.round(gap));
  const prev = chapters[index - 1];
  const next = chapters[index + 1];
  const min = prev ? prev.startFrame + keep : 0;
  const max = Math.min(next ? next.startFrame - keep : Infinity, totalFrames - keep);
  return { min, max };
}

/** 取整到帧，再夹进范围。 */
export function clampEdgeFrame(frame: number, bounds: FrameBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(frame)));
}

export interface EdgeDragInput {
  /** 指针换算出的帧（可以带小数）。 */
  frame: number;
  playheadFrame: number;
  /** 一帧多少像素；0 时不吸附。 */
  pxPerFrame: number;
  snapPx: number;
  bounds: FrameBounds;
}

/** 拖动中的一步：离播放头不到 `snapPx` 像素时吸到播放头，再夹进范围；`snapped` 表示落在播放头上。 */
export function dragEdgeFrame(input: EdgeDragInput): { frame: number; snapped: boolean } {
  const { playheadFrame, pxPerFrame, snapPx, bounds } = input;
  let frame = Math.round(input.frame);
  if (pxPerFrame > 0 && Math.abs(frame - playheadFrame) * pxPerFrame <= snapPx) frame = playheadFrame;
  frame = clampEdgeFrame(frame, bounds);
  return { frame, snapped: frame === playheadFrame };
}

/** 片条上一片的右边：挪的是下一章（`chapter`）的起点。 */
export interface ChipEdge {
  /** 这一片在段里的下标。 */
  index: number;
  chapter: ChapterSpan;
  bounds: FrameBounds;
}

/**
 * 片条上第 `index` 片右边的把手：只有章节段、且后面还有一章时才有（末章的右边是片尾；旁白分段与整条是派生的，没有可改的边界）。
 * 两边各留 `CHIP_EDGE_MIN_SECONDS` 秒；本来就比这更挤的一边不强行推开（范围放宽到含当前位置），挪不动时没有把手。
 * `chapters` 是 `sequenceChapters` 的全集（含长度为 0 的），段按 ID 对回去。
 */
export function chipEdge(
  segments: readonly Pick<LiteSegment, 'id' | 'source'>[],
  chapters: readonly ChapterSpan[],
  index: number,
  fps: Rate,
  totalFrames: number,
): ChipEdge | null {
  const segment = segments[index];
  const after = segments[index + 1];
  if (!segment || !after || segment.source !== 'chapter' || after.source !== 'chapter') return null;
  const at = chapters.findIndex((c) => c.id === after.id);
  const chapter = chapters[at];
  if (!chapter) return null;
  const raw = edgeBounds(chapters, at, totalFrames, secondsToFrames(CHIP_EDGE_MIN_SECONDS, fps));
  const bounds = { min: Math.min(raw.min, chapter.startFrame), max: Math.max(raw.max, chapter.startFrame) };
  return bounds.max > bounds.min ? { index, chapter, bounds } : null;
}

/** 键盘挪一步（← / → 1 秒，⇧ 0.1 秒）：从 `frame` 挪 `seconds` 秒，取整到帧再夹进范围。 */
export function nudgeEdgeFrame(edge: ChipEdge, frame: number, seconds: number, fps: Rate): number {
  return clampEdgeFrame(frame + secondsToFrames(seconds, fps), edge.bounds);
}

/** 边界挪到 `frame` 后，这一片的新时长与增减量（秒）。 */
export function edgeChange(segment: { start: number; end: number }, frame: number, fps: Rate): { duration: number; delta: number } {
  const end = framesToSeconds(frame, fps);
  return { duration: Math.max(0, end - segment.start), delta: end - segment.end };
}

/** 增减量的数字：带正负号、一位小数（`+14.3`、`−2.0`）；单位由文案加。 */
export function signedTenths(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  return `${tenths < 0 ? '−' : '+'}${(Math.abs(tenths) / 10).toFixed(1)}`;
}
