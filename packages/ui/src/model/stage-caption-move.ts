import { clamp, isObject, num, type Json } from '../render/text-style.ts';
import type { CaptionHit } from '../render/render-planner.ts';
import { LINE_STYLE_KEY } from './caption-lines.ts';
import { round1 } from './geometry-panel.ts';
import type { Modifiers, StageEnv } from './stage-gesture.ts';
import { GUIDE_TOL, LIMITS, SNAP_PX, aabbOf, boundsOf, boxRect, dragMove, guidesFor, type Guide, type Limits, type Point, type Pose, type Rect } from './stage-pose.ts';

/**
 * 在画面上拖字幕（原型 stage.jsx 的字幕 SelectionBox）：上下左右都能拖，写的是字幕样式根上的水平中心 `x` 与锚线 `y`
 * （画面宽、高的百分比），用同一份样式的字幕一起动，与属性页「位置」里的「水平位置」「距顶」是同一对值。
 *
 * 吸附按渲染器量出来的真实行框算（`CaptionHit`），不按锚点：锚线可能是块的顶边、中线或底边（`verticalAlign`），把它当中心吸
 * 会差出半个到一个块高。框随 `x`、`y` 等量平移，位移直接折成两者的增量。中心吸附、6px 多线吸附、⌥ 关吸附与元素的移动同一套
 * （`dragMove`）。左右的限位按画出来的字算：框的两边不出画（原型只夹中心，80% 宽的字幕框拖到边上会有一截被裁掉）。
 */

/** 锚线的活动范围（画面高的百分比，原型 `TEXT_LIMITS` 的 y）。 */
export const CAPTION_Y_LIMITS = LIMITS.y;
/** 根样式没写 `x` / `y` 时的水平中心与锚线（与渲染器同值）。 */
export const CAPTION_X = 50;
export const CAPTION_Y = 86;

/** 一次拖字幕：起手时这组字幕（同一份样式）画出来的外包框（画布像素）、根样式的水平中心与锚线、按下的点。 */
export interface CaptionMove {
  box: Rect;
  x0: number;
  y0: number;
  p0: Point;
}

export interface CaptionMoveFrame {
  /** 新的水平中心与锚线（一位小数）。 */
  x: number;
  y: number;
  /** 框比起手时挪了多少画布像素（按取整后的 `x`、`y` 算，画选中框用）。 */
  dx: number;
  dy: number;
  guides: Guide[];
}

/** 这几行的外包框；没有行时是 null。 */
export function captionBox(hits: readonly CaptionHit[]): Rect | null {
  return boundsOf(hits.map((hit) => aabbOf(hit)));
}

/** 一位小数，且不越过 [lo, hi]：贴边时往里取整，字不会因为取整出画半个像素。 */
function within(value: number, lo: number, hi: number): number {
  const r = round1(value);
  return r > hi ? Math.floor(hi * 10) / 10 : r < lo ? Math.ceil(lo * 10) / 10 : r;
}

/** 指针到了 `p`（画布像素）：按起手状态算这一刻的水平中心与锚线。⌥ 关吸附。 */
export function stepCaptionMove(move: CaptionMove, p: Point, mods: Modifiers, env: StageEnv): CaptionMoveFrame {
  const { canvas, others, pxScale } = env;
  const { box, x0, y0 } = move;
  const { width: W, height: H } = canvas;
  if (!(W > 0) || !(H > 0)) return { x: x0, y: y0, dx: 0, dy: 0, guides: [] };
  const start: Pose = { cx: box.x + box.w / 2, cy: box.y + box.h / 2, w: box.w, h: box.h, rotation: 0 };
  const toPct = (px: number, total: number) => (px * 100) / total;
  const toPx = (pct: number, total: number) => (pct * total) / 100;
  const [lo, hi] = CAPTION_Y_LIMITS;
  // 横向：框的两边夹在画布里，比画布还宽就钉在起手位置。纵向：锚线夹在 4–96%。
  // 起手时已经在限位外的，限位放宽到包住起手位置，免得一碰就跳（同 moveLimits）。
  const half = box.w / 2;
  const limits: Limits = {
    x: box.w >= W ? [start.cx, start.cx] : [Math.min(half, start.cx), Math.max(W - half, start.cx)],
    y: [start.cy + Math.min(0, toPx(lo - y0, H)), start.cy + Math.max(0, toPx(hi - y0, H))],
  };
  const snap = mods.alt ? null : { canvas, others, threshold: SNAP_PX * pxScale };
  const moved = dragMove(start, p.x - move.p0.x, p.y - move.p0.y, limits, snap);
  // 多线吸附叠在夹限位之后；横向按限位折成百分比再夹一次，别的对象的边也拽不出画。没动的那一轴原样留着，不顺手取整。
  const x =
    moved.cx === start.cx
      ? x0
      : within(x0 + toPct(moved.cx - start.cx, W), x0 + toPct(limits.x[0] - start.cx, W), x0 + toPct(limits.x[1] - start.cx, W));
  const y = moved.cy === start.cy ? y0 : round1(clamp(y0 + toPct(moved.cy - start.cy, H), 0, 100));
  const dx = toPx(x - x0, W);
  const dy = toPx(y - y0, H);
  const guides = guidesFor(boxRect({ ...start, cx: start.cx + dx, cy: start.cy + dy }), canvas, others, GUIDE_TOL * pxScale);
  return { x, y, dx, dy, guides };
}

/**
 * 根样式换上新的水平中心与锚线（没变的那一项不写，免得把缺省值落进文档）。双语里自己定了位置的那一行（行覆盖里 `x`、`y`
 * 都有，渲染器才当它离开堆栈单独摆）跟着平移同样的量，整组一起动。
 */
export function movedCaptionStyle(root: Json, to: { x: number; y: number }): Json {
  const sx = to.x - num(root.x, CAPTION_X);
  const sy = to.y - num(root.y, CAPTION_Y);
  const next: Json = { ...root };
  if (sx) next.x = to.x;
  if (sy) next.y = to.y;
  const shift = (value: number, by: number) => (by ? round1(clamp(value + by, 0, 100)) : value);
  for (const key of Object.values(LINE_STYLE_KEY)) {
    const line = root[key];
    if (isObject(line) && Number.isFinite(line.x) && Number.isFinite(line.y))
      next[key] = { ...line, x: shift(line.x as number, sx), y: shift(line.y as number, sy) };
  }
  return next;
}
