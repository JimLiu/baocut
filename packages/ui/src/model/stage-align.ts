import type { EditOperation, Id } from '@baocut/protocol';
import { aabbOf, boundsOf, placeFields, poseOf, type Assets, type CanvasSize, type PlacedItem, type Rect } from './stage-pose.ts';

/**
 * 多选的对齐与分布（属性页多选那一页）：按每件旋转后的外包盒量，参照选区的总外包盒或整块画布。
 * 平移外包盒等于平移框中心，所以只改动到的那一轴（`place` 的 `x` 或 `y`），其余字段一概不写；没动的件不出操作。
 * 全部操作放进一笔事务提交（一步撤销）。
 */

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type AlignTarget = 'selection' | 'canvas';
export type Axis = 'x' | 'y';

/** 小于这个位移（画布像素）算没动（落盘的百分比取一位小数，取整后没变的也不出操作）。 */
const STILL = 0.005;

const AXIS_OF: Record<AlignEdge, Axis> = { left: 'x', hcenter: 'x', right: 'x', top: 'y', vcenter: 'y', bottom: 'y' };

/** 一轴上的起点与长度。 */
const startOf = (r: Rect, axis: Axis) => (axis === 'x' ? r.x : r.y);
const sizeOf = (r: Rect, axis: Axis) => (axis === 'x' ? r.w : r.h);

/** 这一件在这一轴上的落点：边对边、中对中。 */
function edgeAt(r: Rect, edge: AlignEdge): number {
  const axis = AXIS_OF[edge];
  const start = startOf(r, axis);
  const size = sizeOf(r, axis);
  if (edge === 'left' || edge === 'top') return start;
  if (edge === 'right' || edge === 'bottom') return start + size;
  return start + size / 2;
}

function referenceOf(rects: Rect[], target: AlignTarget, canvas: CanvasSize): Rect | null {
  return target === 'canvas' ? { x: 0, y: 0, w: canvas.width, h: canvas.height } : boundsOf(rects);
}

function shiftOperations(
  sequenceId: Id,
  items: readonly PlacedItem[],
  axis: Axis,
  deltas: readonly number[],
  canvas: CanvasSize,
  assets: Assets | undefined,
): EditOperation[] {
  const operations: EditOperation[] = [];
  items.forEach((item, i) => {
    const d = deltas[i] ?? 0;
    if (Math.abs(d) < STILL) return;
    const pose = poseOf(item, canvas, assets);
    const moved = axis === 'x' ? { ...pose, cx: pose.cx + d } : { ...pose, cy: pose.cy + d };
    const next = placeFields(item, moved, canvas, assets)[axis];
    if (next === undefined) return;
    operations.push({ type: 'setTransform', sequenceId, itemId: item.id, [axis]: next });
  });
  return operations;
}

/** 把每件的某条边（或中线）对到参照盒的同一条边上。 */
export function alignOperations(
  sequenceId: Id,
  items: readonly PlacedItem[],
  edge: AlignEdge,
  target: AlignTarget,
  canvas: CanvasSize,
  assets?: Assets,
): EditOperation[] {
  const rects = items.map((item) => aabbOf(poseOf(item, canvas, assets)));
  const reference = referenceOf(rects, target, canvas);
  if (!reference) return [];
  const goal = edgeAt(reference, edge);
  return shiftOperations(
    sequenceId,
    items,
    AXIS_OF[edge],
    rects.map((r) => goal - edgeAt(r, edge)),
    canvas,
    assets,
  );
}

/**
 * 等距分布（三件起）：按中线排好次序，件与件之间的空隙一样大。参照选区时最前与最后两件不动；
 * 参照画布时最前一件贴到画布起边、最后一件贴到终边（重叠太多时空隙是负的，照样等分）。
 */
export function distributeOperations(
  sequenceId: Id,
  items: readonly PlacedItem[],
  axis: Axis,
  target: AlignTarget,
  canvas: CanvasSize,
  assets?: Assets,
): EditOperation[] {
  if (items.length < 3) return [];
  const rects = items.map((item) => aabbOf(poseOf(item, canvas, assets)));
  const mid = (i: number) => startOf(rects[i]!, axis) + sizeOf(rects[i]!, axis) / 2;
  const order = rects.map((_, i) => i).sort((a, b) => mid(a) - mid(b) || a - b);
  const first = rects[order[0]!]!;
  const last = rects[order[order.length - 1]!]!;
  const from = target === 'canvas' ? 0 : startOf(first, axis);
  const to = target === 'canvas' ? (axis === 'x' ? canvas.width : canvas.height) : startOf(last, axis) + sizeOf(last, axis);
  const total = rects.reduce((sum, r) => sum + sizeOf(r, axis), 0);
  const gap = (to - from - total) / (items.length - 1);
  const deltas = new Array<number>(items.length).fill(0);
  let cursor = from;
  for (const i of order) {
    const r = rects[i]!;
    deltas[i] = cursor - startOf(r, axis);
    cursor += sizeOf(r, axis) + gap;
  }
  return shiftOperations(sequenceId, items, axis, deltas, canvas, assets);
}
