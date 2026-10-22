import type { ChapterSpan } from './chapters.ts';

/**
 * 拖章节边界的纯规则：时间线的章节条拖一章的起点，提交是一笔 `upsertChapter`（`moveChapterOperation`，`chapters.ts`），
 * 两边各留 1 帧（引擎只拒同一帧）。轻量视图的片条只看不改，不拖边界（轻量编辑器设计 §3.2）。
 */

export interface FrameBounds {
  min: number;
  max: number;
}

/**
 * 一章的起点能挪到哪些帧：上一章的起点之后、下一章的起点之前、片尾之前，各留 `gap` 帧；第一章最早到 0。
 * 两章挤得放不下时 `min > max`，原样返回，由调用方决定（`startBounds` 收成一点）。
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
