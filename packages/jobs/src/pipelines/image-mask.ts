import zlib from 'node:zlib';
import type { EditImageAnchor, EditImageExpand, EditImageMask } from '@baocut/protocol';

/**
 * 图片编辑的选区与画布几何（架构设计 §7.9）：选区按原图像素记，框与笔画（以半径沿折线涂抹）的并集。这里只做纯计算：外框、
 * 覆盖率、换算到别的尺寸、栅格化成灰度遮罩（PNG），以及 AI 修补的工作区与扩图的新画布。界面原型的同名规则在
 * `designs/baocut/app/model-image-edit.js`。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** AI 修补的工作区每边至少这么长（像素）：太小的一块模型看不出上下文。 */
export const WORK_AREA_MIN = 512;
/** 扩图后每边的上限（像素）。 */
export const EXPAND_MAX_SIDE = 4096;
/** 选区占画面超过这个比例时拒绝：那已经不是修补，换生成图片。 */
export const MAX_MASK_COVERAGE = 0.6;

/** 选区换算到另一张图（批量去水印：按宽高的比例，同一个相对位置）。 */
export function scaleMask(mask: EditImageMask, from: { width: number; height: number }, to: { width: number; height: number }): EditImageMask {
  if (from.width === to.width && from.height === to.height) return mask;
  const kx = to.width / from.width;
  const ky = to.height / from.height;
  return {
    boxes: (mask.boxes ?? []).map((b) => ({ x: Math.round(b.x * kx), y: Math.round(b.y * ky), width: Math.round(b.width * kx), height: Math.round(b.height * ky) })),
    strokes: (mask.strokes ?? []).map((s) => ({
      radius: Math.max(1, Math.round(s.radius * Math.min(kx, ky))),
      points: s.points.map(([x, y]) => [Math.round(x * kx), Math.round(y * ky)] as [number, number]),
    })),
  };
}

/** 栅格化：`width`×`height` 的一块（从原图的 `origin` 起），选区内 255、外 0；`grow` 把选区向外扩几个像素。 */
export function rasterizeMask(
  mask: EditImageMask,
  width: number,
  height: number,
  options: { origin?: { x: number; y: number }; grow?: number } = {},
): Uint8Array {
  const ox = options.origin?.x ?? 0;
  const oy = options.origin?.y ?? 0;
  const grow = options.grow ?? 0;
  const out = new Uint8Array(width * height);
  for (const b of mask.boxes ?? []) {
    const x0 = Math.max(0, Math.floor(b.x - grow - ox));
    const y0 = Math.max(0, Math.floor(b.y - grow - oy));
    const x1 = Math.min(width, Math.ceil(b.x + b.width + grow - ox));
    const y1 = Math.min(height, Math.ceil(b.y + b.height + grow - oy));
    for (let y = y0; y < y1; y++) out.fill(255, y * width + x0, y * width + Math.max(x0, x1));
  }
  for (const s of mask.strokes ?? []) {
    const r = s.radius + grow;
    s.points.forEach((p, i) => {
      const a = s.points[i - 1] ?? p;
      capsule(out, width, height, a[0] - ox, a[1] - oy, p[0] - ox, p[1] - oy, r);
    });
  }
  return out;
}

/** 从 (ax, ay) 到 (bx, by) 的线段、半径 `r` 以内的像素（像素中心算距离）。 */
function capsule(out: Uint8Array, width: number, height: number, ax: number, ay: number, bx: number, by: number, r: number) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + r));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by) + r));
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ax;
      const py = y + 0.5 - ay;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const qx = px - t * dx;
      const qy = py - t * dy;
      if (qx * qx + qy * qy <= r2) out[y * width + x] = 255;
    }
  }
}

/** 遮罩的外框与覆盖率；遮罩是空的时 null。 */
export function maskStats(pixels: Uint8Array, width: number, height: number): { bounds: Rect; coverage: number } | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!pixels[row + x]) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!count) return null;
  return { bounds: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, coverage: count / (width * height) };
}

/** AI 修补送去的一块：选区外框四周各留一半的上下文，每边至少 {@link WORK_AREA_MIN}（图更小时是整张），不超出原图。 */
export function workArea(bounds: Rect, image: { width: number; height: number }): Rect {
  const side = (len: number, total: number) => Math.min(total, Math.max(WORK_AREA_MIN, len * 2));
  const width = side(bounds.width, image.width);
  const height = side(bounds.height, image.height);
  const clamp = (start: number, len: number, total: number) => Math.max(0, Math.min(total - len, start));
  return {
    x: clamp(Math.round(bounds.x + bounds.width / 2 - width / 2), width, image.width),
    y: clamp(Math.round(bounds.y + bounds.height / 2 - height / 2), height, image.height),
    width,
    height,
  };
}

/** 扩图的新画布与原图在它上面的位置。 */
export interface ExpandPlan {
  width: number;
  height: number;
  x: number;
  y: number;
}

/** `W:H` → 比值；写法不对时 null。 */
export function parseRatio(ratio: string): number | null {
  const match = /^(\d{1,5}):(\d{1,5})$/.exec(ratio);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? w / h : null;
}

/** 按比例时只往缺的方向加（不裁原图）、按锚点放原图；按边扩时四边各加 `margins` 像素。 */
export function expandPlan(image: { width: number; height: number }, expand: EditImageExpand): ExpandPlan {
  if (expand.margins) {
    const m = expand.margins;
    return { width: image.width + m.left + m.right, height: image.height + m.top + m.bottom, x: m.left, y: m.top };
  }
  const r = parseRatio(expand.ratio ?? '') ?? image.width / image.height;
  let width = image.width;
  let height = image.height;
  if (image.width / image.height < r) width = Math.round(image.height * r);
  else height = Math.round(image.width / r);
  const anchor: EditImageAnchor = expand.anchor ?? 'center';
  const col = anchor.includes('left') ? 0 : anchor.includes('right') ? 2 : 1;
  const row = anchor.includes('top') ? 0 : anchor.includes('bottom') ? 2 : 1;
  return { width, height, x: Math.round(((width - image.width) * col) / 2), y: Math.round(((height - image.height) * row) / 2) };
}

/**
 * 扩图的遮罩：新增的部分 255，原图那一块 0；原图四边向里让出 `inset` 像素，羽化的过渡落在原图里，新增部分贴着原图的边上也是
 * 满的新画面。原图之后整块盖回（流程的贴回），所以让出的那一圈不会改到原图。
 */
export function expandMask(plan: ExpandPlan, image: { width: number; height: number }, inset: number): Uint8Array {
  const out = new Uint8Array(plan.width * plan.height).fill(255);
  // 只在新增了的那几边让出：贴着画布边的一边原样保留。
  const left = plan.x > 0 ? inset : 0;
  const top = plan.y > 0 ? inset : 0;
  const right = plan.x + image.width < plan.width ? inset : 0;
  const bottom = plan.y + image.height < plan.height ? inset : 0;
  const x0 = plan.x + left;
  const x1 = Math.max(x0, plan.x + image.width - right);
  for (let y = plan.y + top; y < plan.y + image.height - bottom; y++) out.fill(0, y * plan.width + x0, y * plan.width + x1);
  return out;
}

/** 8 位灰度 PNG。 */
export function encodeGrayPng(pixels: Uint8Array, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(zlib.crc32(data, zlib.crc32(type)), 8 + data.length);
  return out;
}
