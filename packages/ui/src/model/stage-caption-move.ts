import { clamp, isObject, num, type Json } from '../render/text-style.ts';
import type { CaptionHit } from '../render/render-planner.ts';
import { LINE_STYLE_KEY } from './caption-lines.ts';
import { round1 } from './geometry-panel.ts';
import type { Modifiers, StageEnv } from './stage-gesture.ts';
import { GUIDE_TOL, LIMITS, SNAP_PX, aabbOf, boundsOf, boxRect, dragMove, guidesFor, type Guide, type Point, type Pose, type Rect } from './stage-pose.ts';

/**
 * 在画面上拖字幕（原型 stage.jsx 的字幕 SelectionBox、model-pose.js 的 `subtitle: {axis: 'y'}`）：只能上下拖，写的是字幕样式
 * 根上的锚线 `y`（画面高的百分比），用同一份样式的字幕一起动，与属性页「位置」里的「距顶」是同一个值。
 *
 * 吸附按渲染器量出来的真实行框算（`CaptionHit`），不按锚线：锚线可能是块的顶边、中线或底边（`verticalAlign`），把它当中心吸
 * 会差出半个到一个块高。框随 `y` 等量平移，位移直接折成 `y` 的增量。中心吸附、6px 多线吸附、⌥ 关吸附与元素的移动同一套
 * （`dragMove`）；只出横线——字幕框多半横向居中，竖线会一直亮着。
 */

/** 锚线的活动范围（画面高的百分比，原型 `TEXT_LIMITS` 的 y）。 */
export const CAPTION_Y_LIMITS = LIMITS.y;
/** 根样式没写 `y` 时的锚线（与渲染器同值）。 */
export const CAPTION_Y = 86;

/** 一次拖字幕：起手时这组字幕（同一份样式）画出来的外包框（画布像素）、根样式的锚线、按下的点。 */
export interface CaptionMove {
  box: Rect;
  y0: number;
  p0: Point;
}

export interface CaptionMoveFrame {
  /** 新的锚线（一位小数）。 */
  y: number;
  /** 框比起手时下移了多少画布像素（按取整后的 `y` 算，画选中框用）。 */
  dy: number;
  guides: Guide[];
}

/** 这几行的外包框；没有行时是 null。 */
export function captionBox(hits: readonly CaptionHit[]): Rect | null {
  return boundsOf(hits.map((hit) => aabbOf(hit)));
}

/** 指针到了 `p`（画布像素）：按起手状态算这一刻的锚线。⌥ 关吸附。 */
export function stepCaptionMove(move: CaptionMove, p: Point, mods: Modifiers, env: StageEnv): CaptionMoveFrame {
  const { canvas, others, pxScale } = env;
  const { box, y0 } = move;
  const H = canvas.height;
  if (!(H > 0)) return { y: y0, dy: 0, guides: [] };
  const start: Pose = { cx: box.x + box.w / 2, cy: box.y + box.h / 2, w: box.w, h: box.h, rotation: 0 };
  const toPx = (y: number) => ((y - y0) * H) / 100;
  const [lo, hi] = CAPTION_Y_LIMITS;
  // 横向钉死；起手时已经在限位外的，限位放宽到包住起手位置，免得一碰就跳（同 moveLimits）。
  const limits = {
    x: [start.cx, start.cx] as [number, number],
    y: [start.cy + Math.min(0, toPx(lo)), start.cy + Math.max(0, toPx(hi))] as [number, number],
  };
  const snap = mods.alt ? null : { canvas, others, threshold: SNAP_PX * pxScale };
  const moved = dragMove(start, 0, p.y - move.p0.y, limits, snap);
  const y = round1(clamp(y0 + ((moved.cy - start.cy) * 100) / H, 0, 100));
  const dy = toPx(y);
  const guides = guidesFor(boxRect({ ...start, cy: start.cy + dy }), canvas, others, GUIDE_TOL * pxScale).filter((g) => g.axis === 'y');
  return { y, dy, guides };
}

/**
 * 根样式换上新的锚线。双语里自己定了位置的那一行（行覆盖里 `x`、`y` 都有，渲染器才当它离开堆栈单独摆）跟着平移同样的量，
 * 整组一起动。
 */
export function movedCaptionStyle(root: Json, y: number): Json {
  const shift = y - num(root.y, CAPTION_Y);
  const next: Json = { ...root, y };
  for (const key of Object.values(LINE_STYLE_KEY)) {
    const line = root[key];
    if (isObject(line) && Number.isFinite(line.x) && Number.isFinite(line.y))
      next[key] = { ...line, y: round1(clamp((line.y as number) + shift, 0, 100)) };
  }
  return next;
}
