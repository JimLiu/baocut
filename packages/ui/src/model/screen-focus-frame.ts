import type { Crop } from '@baocut/protocol';
import type { MediaLayer } from '../render/frame-plan.ts';
import { unitPoint } from './stage-hit.ts';
import type { Point } from './stage-pose.ts';

/**
 * 舞台上「固定看一点」的取景框（屏幕录制设计 §5，格式规范 §3.18）：一段缩放放大到最大时看得见源画面的哪一块。
 *
 * 坐标都是源画面（转正之后、裁剪之前）的归一化坐标，与 `focus` 同一套。可见区域 V 的算法照抄求值器
 * （`video_model::screen_view_solver` 的 `target`）：V 是裁剪 C 按倍率缩小，以取景点为中心，碰到 C 的边往里推。
 * 画到画布上走帧计划那一层的 `sourceRect` 与 `matrix`（已含裁剪、适配、`place` 的位置、旋转与翻转），所以不用自己再算一遍适配。
 */

/** `[x0, y0, x1, y1]`，归一化的源坐标。 */
export type SourceRect = [number, number, number, number];

/** 画到画布上需要的那一层几何。 */
export type FrameLayer = Pick<MediaLayer, 'matrix' | 'sourceRect'>;

/** 实例的裁剪换成源上的矩形 C；没有裁剪或裁剪无效时是整幅（同 Rust `Crop::is_valid`）。 */
export function cropRect(crop: Crop | null | undefined): SourceRect {
  if (!crop) return [0, 0, 1, 1];
  const { left, top, right, bottom } = crop;
  const sides = [left, top, right, bottom];
  const valid = sides.every((v) => Number.isFinite(v) && v >= 0 && v < 1) && left + right < 1 && top + bottom < 1;
  return valid ? [left, top, 1 - right, 1 - bottom] : [0, 0, 1, 1];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** 放大 `scale` 倍、以 `focus` 为中心时的可见区域 V（夹在 C 里）。 */
export function focusView(focus: Point, scale: number, crop: SourceRect): SourceRect {
  const [c0, c1, c2, c3] = crop;
  const s = scale > 0 ? scale : 1;
  const w = (c2 - c0) / s;
  const h = (c3 - c1) / s;
  const x0 = clamp(focus.x - w / 2, c0, c2 - w);
  const y0 = clamp(focus.y - h / 2, c1, c3 - h);
  return [x0, y0, x0 + w, y0 + h];
}

/** 把取景点夹到 V 不出 C 的范围里：返回的点就是 V 的中心（拖动时写进 `focus` 的值）。 */
export function clampFocus(focus: Point, scale: number, crop: SourceRect): Point {
  const [x0, y0, x1, y1] = focusView(focus, scale, crop);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** 源上的点 → 画布像素（经这一层的取源区域与矩阵）。 */
export function sourceToCanvas(layer: FrameLayer, p: Point): Point {
  const [u0, v0, u1, v1] = layer.sourceRect;
  const [a, b, c, d, e, f] = layer.matrix;
  const x = (p.x - u0) / (u1 - u0 || 1);
  const y = (p.y - v0) / (v1 - v0 || 1);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/** 画布像素 → 源上的点；矩阵退化时给 null。 */
export function canvasToSource(layer: FrameLayer, p: Point): Point | null {
  const unit = unitPoint(layer.matrix, p);
  if (!unit) return null;
  const [u0, v0, u1, v1] = layer.sourceRect;
  return { x: u0 + unit.x * (u1 - u0), y: v0 + unit.y * (v1 - v0) };
}

/** 源上的矩形在画布上的四个角（左上、右上、右下、左下；旋转、翻转之后不一定是正的矩形）。 */
export function rectQuad(layer: FrameLayer, [x0, y0, x1, y1]: SourceRect): [Point, Point, Point, Point] {
  return [
    sourceToCanvas(layer, { x: x0, y: y0 }),
    sourceToCanvas(layer, { x: x1, y: y0 }),
    sourceToCanvas(layer, { x: x1, y: y1 }),
    sourceToCanvas(layer, { x: x0, y: y1 }),
  ];
}

/**
 * 拖动取景框：起手时的取景点加上指针在源上走过的距离，再夹回 V 不出 C 的范围。`from`、`to` 是画布像素；
 * 换算不出来（矩阵退化）时原样返回起手的点。
 */
export function draggedFocus(layer: FrameLayer, start: Point, from: Point, to: Point, scale: number, crop: SourceRect): Point {
  const a = canvasToSource(layer, from);
  const b = canvasToSource(layer, to);
  if (!a || !b) return clampFocus(start, scale, crop);
  return clampFocus({ x: start.x + b.x - a.x, y: start.y + b.y - a.y }, scale, crop);
}
