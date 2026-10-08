import type { Id, Sequence } from '@baocut/protocol';
import { itemFrames } from './editor.ts';
import { rectsCross, type Rect } from './stage-pose.ts';

/**
 * 时间线框选（设计稿 timeline.jsx `beginMarquee`，产品设计 §7）：在轨道区空白处拖出矩形，框到的实例全选、跨轨道。
 * 命中判据与舞台同一个（`rectsCross`：相交就算、贴边不算），只是盒不从 DOM 量，而是按「时段 × 行」现算——
 * 时间线上一件实例的盒就是它的时段和它那一行（整行高度，同设计稿）。锁着的轨道与锁着的实例不选。
 * 字幕实例不选：一个字幕实例通常铺满整条字幕轨，框到一角就选中整层、按 Delete 整层没了；设计稿框的是一句句字幕，从不选中整条字幕轨。
 * 跟着视频的字幕（`scopeItemIds`）随视频一起删、一起合拢（timeline-ripple.ts）。要选整层就点字幕行。
 *
 * 坐标都在时间线的内容坐标系里（随滚动走的那一层：左边含行头列，上边含刻度尺），所以滚动与缩放下不漂。
 */

/** 一行在内容坐标系里的纵向位置。 */
export interface MarqueeLane {
  trackId: Id;
  top: number;
  height: number;
}

/** 横向换算：内容坐标 x = `head + pad + 秒 × pxPerSecond`。 */
export interface MarqueeLayout {
  head: number;
  pad: number;
  pxPerSecond: number;
  lanes: readonly MarqueeLane[];
}

/** 一件实例在内容坐标系里的盒；它所在的轨道没有画出来时 null。 */
export function itemBox(sequence: Sequence, itemId: Id, layout: MarqueeLayout): Rect | null {
  const item = sequence.items.find((candidate) => candidate.id === itemId);
  const lane = item ? layout.lanes.find((l) => l.trackId === item.trackId) : undefined;
  if (!item || !lane) return null;
  const perSecond = sequence.fps.num / sequence.fps.den;
  const range = itemFrames(item, sequence.fps);
  const x0 = layout.head + layout.pad + (range.start / perSecond) * layout.pxPerSecond;
  const x1 = layout.head + layout.pad + (range.end / perSecond) * layout.pxPerSecond;
  return { x: x0, y: lane.top, w: Math.max(0, x1 - x0), h: lane.height };
}

/** 框到的实例（按序列里的次序）：跳过锁着的轨道、锁着的实例与字幕实例。 */
export function marqueeItems(sequence: Sequence, layout: MarqueeLayout, rect: Rect): Id[] {
  const locked = new Set(sequence.tracks.filter((t) => t.locked).map((t) => t.id));
  const hits: Id[] = [];
  for (const item of sequence.items) {
    if (item.locked || locked.has(item.trackId) || item.type === 'caption') continue;
    const box = itemBox(sequence, item.id, layout);
    if (box && box.w > 0 && rectsCross(box, rect)) hits.push(item.id);
  }
  return hits;
}

/** 松手后的选区：按着 ⇧ / ⌘ 是在原选区上并入（去重，不是反选），否则换成框到的。 */
export function marqueeSelection(current: readonly Id[], hits: readonly Id[], additive: boolean): Id[] {
  return additive ? [...new Set([...current, ...hits])] : [...hits];
}
