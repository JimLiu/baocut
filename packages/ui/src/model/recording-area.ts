/*
 * 选取覆盖层与摄像头浮窗的几何（屏幕录制设计 §11「选取覆盖层」「摄像头浮窗」）。
 * 单位是屏幕的逻辑点；矩形都相对所在的那块屏幕，`b` 是屏幕本身（`{x: 0, y: 0, width, height}`）。
 * 控制条与浮窗在屏幕上的缺省位置由主进程算（apps/desktop/src/main/recording/recording-rules.ts）。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 区域最小 150 × 150：更小时录制卡的「开始录制」不可用。 */
export const MIN_AREA = 150;
/** 边长不足 80 时不显示那条边中间的条形把手。 */
export const EDGE_HANDLE_MIN = 80;
/** 录制卡与选区的间距。 */
export const CARD_GAP = 16;

export const RATIOS = [
  { id: 'free', value: 0 },
  { id: '16:9', value: 16 / 9 },
  { id: '4:3', value: 4 / 3 },
  { id: '1:1', value: 1 },
  { id: '9:16', value: 9 / 16 },
] as const;

export type RatioId = (typeof RATIOS)[number]['id'];

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function ratioOf(id: RatioId): number {
  return (RATIOS.find((r) => r.id === id) ?? RATIOS[0]).value;
}

export function isRatioId(value: unknown): value is RatioId {
  return RATIOS.some((r) => r.id === value);
}

const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const contains = (r: Rect, p: Point) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

/** 把矩形整体挪回屏幕里（比屏幕大时先截到屏幕大小）。 */
export function clampRect(r: Rect, b: Rect): Rect {
  const width = Math.min(r.width, b.width);
  const height = Math.min(r.height, b.height);
  return { x: clampN(r.x, b.x, b.x + b.width - width), y: clampN(r.y, b.y, b.y + b.height - height), width, height };
}

/** 从按下点 `a` 拖到 `p` 画出的选区：有比例时以拖得更远的一边为准，碰到屏幕边整体缩回；截在屏幕里。 */
export function drawRect(a: Point, p: Point, ratio: RatioId, b: Rect): Rect {
  const px = clampN(p.x, b.x, b.x + b.width);
  const py = clampN(p.y, b.y, b.y + b.height);
  let w = Math.abs(px - a.x);
  let h = Math.abs(py - a.y);
  const sx = px < a.x ? -1 : 1;
  const sy = py < a.y ? -1 : 1;
  const k = ratioOf(ratio);
  if (k) {
    if (w / k >= h) h = w / k;
    else w = h * k;
    const maxW = sx > 0 ? b.x + b.width - a.x : a.x - b.x;
    const maxH = sy > 0 ? b.y + b.height - a.y : a.y - b.y;
    const f = Math.min(1, maxW / Math.max(w, 1e-6), maxH / Math.max(h, 1e-6));
    w *= f;
    h *= f;
  }
  return round({ x: sx > 0 ? a.x : a.x - w, y: sy > 0 ? a.y : a.y - h, width: w, height: h });
}

/** 在选区里拖动是移动：不出屏幕。 */
export function moveRect(r: Rect, dx: number, dy: number, b: Rect): Rect {
  return round(clampRect({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }, b));
}

/**
 * 拖把手改大小：对边（对角）固定。有比例时角把手按宽定高，边把手改一边、另一边按比例并以中线为轴。
 * 不小于 1，不出屏幕。
 */
export function resizeRect(r: Rect, handle: Handle, dx: number, dy: number, ratio: RatioId, b: Rect): Rect {
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.width;
  let y1 = r.y + r.height;
  if (handle.includes('w')) x0 = clampN(x0 + dx, b.x, x1 - 1);
  if (handle.includes('e')) x1 = clampN(x1 + dx, x0 + 1, b.x + b.width);
  if (handle.includes('n')) y0 = clampN(y0 + dy, b.y, y1 - 1);
  if (handle.includes('s')) y1 = clampN(y1 + dy, y0 + 1, b.y + b.height);
  const k = ratioOf(ratio);
  if (!k) return round({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  let w = x1 - x0;
  let h = y1 - y0;
  const horiz = handle === 'e' || handle === 'w';
  const vert = handle === 'n' || handle === 's';
  if (vert) w = h * k;
  else h = w / k;
  const ax = handle.includes('w') ? x1 : handle.includes('e') ? x0 : r.x + r.width / 2;
  const ay = handle.includes('n') ? y1 : handle.includes('s') ? y0 : r.y + r.height / 2;
  const corner = handle.length === 2;
  const maxW = horiz || corner ? (handle.includes('w') ? ax - b.x : b.x + b.width - ax) : 2 * Math.min(ax - b.x, b.x + b.width - ax);
  const maxH = vert || corner ? (handle.includes('n') ? ay - b.y : b.y + b.height - ay) : 2 * Math.min(ay - b.y, b.y + b.height - ay);
  const f = Math.min(1, maxW / w, maxH / h);
  w *= f;
  h *= f;
  const x = handle.includes('w') ? ax - w : handle.includes('e') ? ax : ax - w / 2;
  const y = handle.includes('n') ? ay - h : handle.includes('s') ? ay : ay - h / 2;
  return round({ x, y, width: w, height: h });
}

/** 换比例：保持中心与宽度（放不下时缩），截在屏幕里。没有选区或「自由」时原样返回。 */
export function applyRatio(r: Rect | null, ratio: RatioId, b: Rect): Rect | null {
  const k = ratioOf(ratio);
  if (!r || !k) return r;
  let w = r.width;
  let h = r.width / k;
  const f = Math.min(1, b.width / w, b.height / h);
  w *= f;
  h *= f;
  return round(clampRect({ x: r.x + r.width / 2 - w / 2, y: r.y + r.height / 2 - h / 2, width: w, height: h }, b));
}

const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** 方向键微移：一次 1，按住 Shift 一次 10。别的键原样返回。 */
export function nudge(r: Rect, key: string, shift: boolean, b: Rect): Rect {
  const d = NUDGE[key];
  if (!d) return r;
  const s = shift ? 10 : 1;
  return moveRect(r, d[0] * s, d[1] * s, b);
}

/** 任一边不足 150。 */
export function tooSmall(r: Rect | null): boolean {
  return !!r && (r.width < MIN_AREA || r.height < MIN_AREA);
}

/** 四边的条形把手显示与否。 */
export function edgeHandles(r: Pick<Rect, 'width' | 'height'>): { n: boolean; s: boolean; e: boolean; w: boolean } {
  const wide = r.width >= EDGE_HANDLE_MIN;
  const tall = r.height >= EDGE_HANDLE_MIN;
  return { n: wide, s: wide, e: tall, w: tall };
}

export function fillScreen(b: Rect): Rect {
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

/** 贴合窗口：窗口的边界截在屏幕里。 */
export function fitWindow(win: Rect, b: Rect): Rect {
  const x0 = Math.max(win.x, b.x);
  const y0 = Math.max(win.y, b.y);
  const x1 = Math.min(win.x + win.width, b.x + b.width);
  const y1 = Math.min(win.y + win.height, b.y + b.height);
  return round({ x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) });
}

/** 鼠标下最前面的窗口：`windows` 按从前到后排（`recordings.sources` 的次序）。 */
export function windowAt<T extends Rect>(windows: readonly T[], p: Point): T | null {
  return windows.find((w) => contains(w, p)) ?? null;
}

/** 区域模式录制卡的位置：选区下方 16；放不下放上方；都放不下放选区内靠上。水平与选区居中，离屏幕边至少 8。 */
export function cardPlacement(sel: Rect, b: Rect, card: { width: number; height: number }): { x: number; y: number; where: 'below' | 'above' | 'inside' } {
  const x = Math.round(clampN(sel.x + sel.width / 2 - card.width / 2, b.x + 8, b.x + b.width - card.width - 8));
  if (sel.y + sel.height + CARD_GAP + card.height <= b.y + b.height) return { x, y: sel.y + sel.height + CARD_GAP, where: 'below' };
  if (sel.y - CARD_GAP - card.height >= b.y) return { x, y: sel.y - CARD_GAP - card.height, where: 'above' };
  return { x, y: Math.max(b.y, sel.y) + CARD_GAP, where: 'inside' };
}

/** 读数「宽 × 高」。 */
export function sizeText(r: Pick<Rect, 'width' | 'height'>): string {
  return `${Math.round(r.width)} × ${Math.round(r.height)}`;
}

// ---- 摄像头浮窗 ----

export const CAMERA = { size: 230, big: 400, min: 150, max: 600 } as const;
export const CAMERA_SHAPES = ['round', 'square', 'wide'] as const;
export type CameraShape = (typeof CAMERA_SHAPES)[number];

export function isCameraShape(value: unknown): value is CameraShape {
  return (CAMERA_SHAPES as readonly unknown[]).includes(value);
}

/** 形状按 圆 → 方 → 宽屏 循环。 */
export function nextShape(s: CameraShape): CameraShape {
  return CAMERA_SHAPES[(CAMERA_SHAPES.indexOf(s) + 1) % CAMERA_SHAPES.length]!;
}

/** 浮窗尺寸：圆与方是 size × size，宽屏 16:9 时宽是 size。 */
export function cameraBox(size: number, shape: CameraShape): { width: number; height: number } {
  return shape === 'wide' ? { width: size, height: Math.round((size * 9) / 16) } : { width: size, height: size };
}

/** 大小按钮：230 ↔ 400（不在这两档时回到 230）。 */
export function toggleCameraSize(size: number): number {
  return size === CAMERA.size ? CAMERA.big : CAMERA.size;
}

/** 拖角缩放：按拖得更远的方向改 size，限 150–600。 */
export function resizeCamera(size: number, corner: 'nw' | 'ne' | 'sw' | 'se', dx: number, dy: number): number {
  const sx = corner.includes('w') ? -dx : dx;
  const sy = corner.includes('n') ? -dy : dy;
  const d = Math.abs(sx) >= Math.abs(sy) ? sx : sy;
  return Math.round(clampN(size + d, CAMERA.min, CAMERA.max));
}

export function clampCameraSize(size: unknown): number {
  return typeof size === 'number' && Number.isFinite(size) ? Math.round(clampN(size, CAMERA.min, CAMERA.max)) : CAMERA.size;
}
