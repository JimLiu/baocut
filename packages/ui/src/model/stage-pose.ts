import { stageBox, stagePlace, type StageAsset, type StageItem } from '@baocut/editor-wasm';
import { isVisualItem, type AssetRecord, type Id, type Place, type SequenceItem, type VisualItem } from '@baocut/protocol';
import { round1, wrapRotation } from './geometry-panel.ts';

/**
 * 舞台上摆实例的几何（照原型 model-pose.js 与 model-select.js）：能力表与把手集合、移动 / 改边 / 缩放 / 旋转、
 * 吸附与参考线、多选的整体平移与缩放、方向键微调。
 *
 * 坐标一律是序列画布像素、左上原点。盒子用中心表示（`Pose`）。落盘的是元素模型的 `place`（画幅百分比：框中心、
 * 框宽；高由种类推出，`scaleY` 再乘一次高），与盒互换只在 `poseOf` / `placeFields` 两处，两处都调 Rust 帧计划的那一份
 * （`render-graph` 的 `item_box` / `place_from_box`，经 `editor-wasm`）。这里只剩手势本身：把手、吸附、限位、多选与键盘。
 * 原型的阈值量的是画面像素（6px 吸附、2px 死区……），调用方按显示比例换成画布像素再传进来。
 */

export interface Point {
  x: number;
  y: number;
}
/** 左上角口径的轴对齐盒。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** 实例的框：中心、未旋转的宽高、绕中心看的角度（度，顺时针）。 */
export interface Pose {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}
export interface CanvasSize {
  width: number;
  height: number;
}
/** 视频的素材表：媒体实例的框高按源的显示宽高比推，要查它。 */
export type Assets = Readonly<Record<Id, AssetRecord>>;

/** 吸附阈值（画面像素）。 */
export const SNAP_PX = 6;
/** 中心吸附半径：画布宽 / 高的百分比。 */
export const CENTER_SNAP = 1.5;
/** 旋转栅格（度）。 */
export const ROT_STEP = 15;
/** 起手死区（画面像素）：这以内仍算点击。 */
export const DEAD_ZONE = 2;
/** 参考线的重合判据（画面像素）。 */
export const GUIDE_TOL = 1;
/** 一次缩放手势的倍率范围。 */
export const SCALE_MIN = 0.1;
export const SCALE_MAX = 5;
/** 框最窄：画布宽的 2%，且不少于 10 像素；最大到画布的 400%（填满画布要能长出画面外）。 */
export const MIN_W = 2;
export const MIN_PX = 10;
export const MAX_SIZE = 400;
/** 把手退化的判据（画面像素）：任一边小于 24 换成少几个的那一套。 */
export const SMALL_SET = 24;
/** 小一档把手样式的判据（画面像素，与上面不同口径）。 */
export const SMALL_STYLE_W = 50;
export const SMALL_STYLE_H = 40;
/** 视频允许大半出画，只留 min(盒边, 10%) 的可见带。 */
export const KEEP_VISIBLE = 10;
/** 非视频的中心限位（画布百分比）。 */
export const LIMITS = { x: [3, 97], y: [4, 96] } as const;
/** 框选的起拖阈值（画面像素）。 */
export const MARQUEE_MIN = 4;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rad = (deg: number) => (deg * Math.PI) / 180;

// ---- 能力表与把手 ----

export type Handle = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
/**
 * 改大小的三档（原型 CAPS 的 `resize`）：
 * - `free` 八把手，宽高比自由（四角默认仍锁比例，⇧ 解锁）：视频、合成，以及框高按画幅定的生成类元素；
 * - `text` 左右改框宽（字号不变、重新折行）＋ 四角连字号一起等比放大：文字；
 * - `corner` 只有四角、恒锁比例：图片、图形、贴纸、白板。
 */
export type ResizeKind = 'free' | 'text' | 'corner';

/** 舞台上能摆的实例：有 `place` 的画面实例。 */
export type PlacedItem = VisualItem;

export function isPlaced(item: SequenceItem): item is PlacedItem {
  return isVisualItem(item);
}

export function resizeKindOf(item: PlacedItem): ResizeKind {
  if (item.type === 'text') return 'text';
  if (item.type === 'image' || item.type === 'shape' || item.type === 'sticker' || item.type === 'whiteboard') return 'corner';
  return 'free';
}

const HANDLE_SETS: Record<ResizeKind, { big: Handle[]; small: Handle[] }> = {
  free: { big: ['n', 'w', 's', 'e', 'nw', 'ne', 'sw', 'se'], small: ['nw', 's', 'e'] },
  text: { big: ['w', 'e', 'nw', 'ne', 'sw', 'se'], small: ['se', 'e'] },
  corner: { big: ['nw', 'ne', 'sw', 'se'], small: ['nw'] },
};

/** 这一档此刻出哪几个把手；`w` / `h` 是未旋转的盒尺寸（画面像素），任一边 < 24 就退化。 */
export function handlesFor(kind: ResizeKind, w: number, h: number): Handle[] {
  const set = HANDLE_SETS[kind];
  return w < SMALL_SET || h < SMALL_SET ? set.small : set.big;
}

export const smallHandles = (w: number, h: number) => w < SMALL_STYLE_W || h < SMALL_STYLE_H;
export const isCorner = (handle: Handle) => handle.length === 2;

/** 四角是等比缩放（文字连字号、图片与图形）还是改宽高（自由一档）。 */
export function cornerScales(kind: ResizeKind, handle: Handle): boolean {
  return isCorner(handle) && kind !== 'free';
}

const CURSOR_ORDER: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const CURSOR_STEP = [0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8, 0];

/** 光标随旋转角转：30° 一格查表（原型 `resizeCursor`，45° 附近落在同一档）。 */
export function resizeCursor(handle: Handle, rotation: number): string {
  const a = wrapRotation(rotation);
  const n = a < 0 ? a + 360 : a;
  const step = CURSOR_STEP[Math.floor(n / 30)] ?? 0;
  return `${CURSOR_ORDER[(CURSOR_ORDER.indexOf(handle) + step) % 8]}-resize`;
}

// ---- place ↔ 盒 ----

/** 推框要看的那几样（`editor-wasm` 只读这些）：种类、`place`、`mode`、图形与贴纸的属性、裁剪。 */
function stageItem(item: PlacedItem): StageItem {
  const out: StageItem = { type: item.type, place: item.place };
  if ('mode' in item && item.mode !== undefined) out.mode = item.mode;
  if (item.type === 'shape') out.shape = item.shape;
  if (item.type === 'sticker') out.sticker = item.sticker;
  if ((item.type === 'video' || item.type === 'image') && item.crop) out.crop = item.crop;
  return out;
}

/** 实例引用的素材（合成是预渲染）里推框要看的部分：种类与引用的那个版本的视频信息；素材表里没有时不传。 */
function stageAsset(item: PlacedItem, assets: Assets | undefined): StageAsset | undefined {
  const ref = item.type === 'composition' ? item.prerender : 'assetRef' in item ? item.assetRef : undefined;
  const record = ref ? assets?.[ref.id] : undefined;
  if (!ref || !record) return undefined;
  const video = record.revisions[ref.revision]?.video;
  return video ? { kind: record.kind, video } : { kind: record.kind };
}

const sizeOf = (canvas: CanvasSize): CanvasSize => ({ width: canvas.width, height: canvas.height });

/**
 * `place` → 盒：帧计划画层用的同一个框（`render-graph` 的 `item_box`，经 `editor-wasm` 同步调）。媒体的框高按 `assets` 里
 * 源的显示宽高比（含裁剪），查不到时按画布的；贴纸与占位框的素材是图片或视频时按媒体摆。
 */
export function poseOf(item: PlacedItem, canvas: CanvasSize, assets?: Assets): Pose {
  const { cx, cy, w, h, rotation } = stageBox(stageItem(item), sizeOf(canvas), stageAsset(item, assets));
  return { cx, cy, w, h, rotation };
}

/** 能不能改位置与大小：铺满画布的实例的框不看 `place`，只能转。 */
export function posable(item: PlacedItem, canvas: CanvasSize, assets?: Assets): boolean {
  return !stageBox(stageItem(item), sizeOf(canvas), stageAsset(item, assets)).fullscreen;
}

/** `setTransform` 写进 `place` 的那几个字段。 */
export type PlaceFields = Partial<Pick<Place, 'x' | 'y' | 'w' | 'scaleY' | 'rot'>>;

/**
 * 盒 → `place`（`poseOf` 的反函数，同在 `render-graph`）：只给出取整后和此刻不同的字段（什么都没变是空对象）。`scale` 不动，
 * 框宽折成 `w`；框高写进 `scaleY`（高 ÷ 按落盘的宽推出的自然高）。百分比与角度取一位小数、`scaleY` 取三位；铺满画布的只写角度。
 */
export function placeFields(item: PlacedItem, pose: Pose, canvas: CanvasSize, assets?: Assets): PlaceFields {
  const { cx, cy, w, h, rotation } = pose;
  if (![cx, cy, w, h, rotation].every(Number.isFinite)) return {};
  return stagePlace(stageItem(item), { cx, cy, w, h, rotation }, sizeOf(canvas), stageAsset(item, assets));
}

/** 旋转的枢轴：框的中心（元素模型绕中心转）。 */
export function pivotOf(item: PlacedItem, canvas: CanvasSize, assets?: Assets): Point {
  const pose = poseOf(item, canvas, assets);
  return { x: pose.cx, y: pose.cy };
}

/** 盒的局部点（相对中心、未旋转）→ 画布点。 */
function toCanvas(pose: Pose, lx: number, ly: number): Point {
  const cos = Math.cos(rad(pose.rotation));
  const sin = Math.sin(rad(pose.rotation));
  return { x: pose.cx + lx * cos - ly * sin, y: pose.cy + lx * sin + ly * cos };
}

/** 四个角：左上、右上、右下、左下（旋转之后）。 */
export function cornersOf(pose: Pose): [Point, Point, Point, Point] {
  const hw = pose.w / 2;
  const hh = pose.h / 2;
  return [toCanvas(pose, -hw, -hh), toCanvas(pose, hw, -hh), toCanvas(pose, hw, hh), toCanvas(pose, -hw, hh)];
}

/** 点落在旋转过的盒里没有（边上算）。 */
export function poseContains(pose: Pose, p: Point): boolean {
  const cos = Math.cos(rad(-pose.rotation));
  const sin = Math.sin(rad(-pose.rotation));
  const dx = p.x - pose.cx;
  const dy = p.y - pose.cy;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= pose.w / 2 + 1e-9 && Math.abs(ly) <= pose.h / 2 + 1e-9;
}

/** 旋转之后的外包盒。 */
export function aabbOf(pose: Pose): Rect {
  const c = Math.abs(Math.cos(rad(pose.rotation)));
  const s = Math.abs(Math.sin(rad(pose.rotation)));
  const w = pose.w * c + pose.h * s;
  const h = pose.w * s + pose.h * c;
  return { x: pose.cx - w / 2, y: pose.cy - h / 2, w, h };
}

/** 未旋转的盒（吸附按它算，与原型 `frameBox` 同口径）。 */
export function boxRect(pose: Pose): Rect {
  return { x: pose.cx - pose.w / 2, y: pose.cy - pose.h / 2, w: pose.w, h: pose.h };
}

// ---- 移动 ----

/** 中心的活动范围（画布像素）。 */
export interface Limits {
  x: [number, number];
  y: [number, number];
}

/**
 * 移动限位：视频按盒子放宽（只留 min(盒边, 10%) 的可见带，原型 `mediaLimits`），其余中心夹在 3–97% / 4–96%。
 * 起手时已经在限位外的，限位放宽到包住起手位置，免得一碰就跳。
 */
export function moveLimits(item: PlacedItem, pose: Pose, canvas: CanvasSize): Limits {
  const media = (size: number, total: number): [number, number] => {
    const keep = Math.min(size, (total * KEEP_VISIBLE) / 100);
    return [keep - size / 2, total - keep + size / 2];
  };
  const fixed = (range: readonly number[], total: number): [number, number] => [(range[0]! * total) / 100, (range[1]! * total) / 100];
  const base =
    item.type === 'video'
      ? { x: media(pose.w, canvas.width), y: media(pose.h, canvas.height) }
      : { x: fixed(LIMITS.x, canvas.width), y: fixed(LIMITS.y, canvas.height) };
  return {
    x: [Math.min(base.x[0], pose.cx), Math.max(base.x[1], pose.cx)],
    y: [Math.min(base.y[0], pose.cy), Math.max(base.y[1], pose.cy)],
  };
}

/** 参考线：`axis: 'x'` 是一条竖线（画在 x = at），`'y'` 是横线。 */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
}

/** 吸附的上下文：画布、其它对象的盒（未旋转）、阈值（画布像素）。`null` 表示不吸（按住 ⌥）。 */
export interface SnapContext {
  canvas: CanvasSize;
  others: Rect[];
  threshold: number;
}

const edgesX = (b: Rect) => [b.x, b.x + b.w / 2, b.x + b.w];
const edgesY = (b: Rect) => [b.y, b.y + b.h / 2, b.y + b.h];

/** 一根轴上的候选线：画布的起边、中线、终边在前（等距时画布赢），然后是其它对象的边与中线。 */
function axisLines(extent: number, others: Rect[], pick: (b: Rect) => number[]): number[] {
  return [0, extent / 2, extent, ...others.flatMap(pick)];
}

function snapAxis(moving: number[], lines: number[], threshold: number): { delta: number; lines: number[] } | null {
  let best: number | null = null;
  for (const edge of moving) {
    for (const line of lines) {
      const d = line - edge;
      if (Math.abs(d) > threshold) continue;
      if (best === null || Math.abs(d) < Math.abs(best) || (Math.abs(d) === Math.abs(best) && d < best)) best = d;
    }
  }
  if (best === null) return null;
  const hit: number[] = [];
  for (const edge of moving) {
    const line = lines.find((l) => Math.abs(l - (edge + best)) <= 1e-6);
    if (line !== undefined && !hit.some((h) => Math.abs(h - line) <= 1e-6)) hit.push(line);
  }
  return { delta: best, lines: hit };
}

/** 多线吸附：盒的三条边逐一对全部候选线试，取最近的位移；返回还要再加的位移与对上的线。 */
export function snapMove(box: Rect, snap: SnapContext): { dx: number; dy: number; guides: Guide[] } {
  const { canvas, others, threshold } = snap;
  const out = { dx: 0, dy: 0, guides: [] as Guide[] };
  if (!(canvas.width > 0) || !(canvas.height > 0)) return out;
  const sx = snapAxis(edgesX(box), axisLines(canvas.width, others, edgesX), threshold);
  if (sx) {
    out.dx = sx.delta;
    for (const at of sx.lines) out.guides.push({ axis: 'x', at });
  }
  const sy = snapAxis(edgesY(box), axisLines(canvas.height, others, edgesY), threshold);
  if (sy) {
    out.dy = sy.delta;
    for (const at of sy.lines) out.guides.push({ axis: 'y', at });
  }
  return out;
}

/** 这个盒子此刻贴着哪几条线（渲染期的参考线，不是求解器）：按住 ⌥ 不吸，但压在线上照样画。 */
export function guidesFor(box: Rect, canvas: CanvasSize, others: Rect[], tolerance: number): Guide[] {
  if (!(canvas.width > 0) || !(canvas.height > 0)) return [];
  const out: Guide[] = [];
  const axes: [number[], number[], Guide['axis']][] = [
    [edgesX(box), axisLines(canvas.width, others, edgesX), 'x'],
    [edgesY(box), axisLines(canvas.height, others, edgesY), 'y'],
  ];
  for (const [edges, lines, axis] of axes) {
    for (const edge of edges) {
      const line = lines.find((l) => Math.abs(l - edge) <= tolerance);
      if (line === undefined) continue;
      if (!out.some((g) => g.axis === axis && Math.abs(g.at - line) <= 1e-6)) out.push({ axis, at: line });
    }
  }
  return out;
}

/**
 * 移动：先把中心吸到画布中线（±1.5%）并夹进限位，再叠多线吸附（原型 `dragPos` 后接 `snapMove`）。
 * `snap` 为 null（⌥）时两步吸附都不参与，只夹限位。
 */
export function dragMove(start: Pose, dx: number, dy: number, limits: Limits, snap: SnapContext | null): Pose {
  let cx = start.cx + dx;
  let cy = start.cy + dy;
  if (snap) {
    const { width: W, height: H } = snap.canvas;
    if (Math.abs(cx - W / 2) < (W * CENTER_SNAP) / 100) cx = W / 2;
    if (Math.abs(cy - H / 2) < (H * CENTER_SNAP) / 100) cy = H / 2;
  }
  cx = clamp(cx, limits.x[0], limits.x[1]);
  cy = clamp(cy, limits.y[0], limits.y[1]);
  if (snap) {
    const s = snapMove(boxRect({ ...start, cx, cy }), snap);
    cx += s.dx;
    cy += s.dy;
  }
  return { ...start, cx, cy };
}

// ---- 改边与四角 ----

/** 框的尺寸范围（画布像素）：宽不窄于画布 2% 与 10 像素，高不矮于 10 像素，都不超过画布的 400%。 */
export function sizeRange(canvas: CanvasSize): { min: { w: number; h: number }; max: { w: number; h: number } } {
  return {
    min: { w: Math.max((canvas.width * MIN_W) / 100, MIN_PX), h: MIN_PX },
    max: { w: (canvas.width * MAX_SIZE) / 100, h: (canvas.height * MAX_SIZE) / 100 },
  };
}

export interface EdgeResize {
  handle: Handle;
  /** 指针总位移（画布像素）。 */
  dx: number;
  dy: number;
  start: Pose;
  /** ⌥：以中心为锚、位移双倍计入。 */
  alt: boolean;
  /** ⇧：自由一档的四角解锁比例。 */
  shift: boolean;
  /** 锁死的宽高比（宽 / 高）；null 是自由。 */
  ratio: number | null;
  range: { min: { w: number; h: number }; max: { w: number; h: number } };
}

/**
 * 改边（原型 `edgeResize`，闭式解）：位移投影到盒子旋转后的自身轴，左 / 上两侧取反；四角在
 * `⌥ || !⇧ || 锁比例` 时把两轴摊成同一个比例；锚在对边中点 / 对角（⌥ 在中心），新中心 = 旧中心 + R(θ)·((1−sx)·ax, (1−sy)·ay)。
 */
export function edgeResize(o: EdgeResize): Pose {
  const { handle, start } = o;
  const w0 = Math.max(start.w, 1e-6);
  const h0 = Math.max(start.h, 1e-6);
  const cos = Math.cos(rad(start.rotation));
  const sin = Math.sin(rad(start.rotation));
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  let dw = o.dx * cos + o.dy * sin;
  let dh = o.dy * cos - o.dx * sin;
  if (west) dw = -dw;
  if (north) dh = -dh;
  if (isCorner(handle) && (o.alt || !o.shift || o.ratio !== null)) {
    const g = o.ratio ?? w0 / h0;
    const r = (dh + dw) / (1 + g);
    dh = r;
    dw = r * g;
  }
  const sx = west || east ? clamp(w0 + (o.alt ? dw * 2 : dw), o.range.min.w, o.range.max.w) / w0 : 1;
  const sy = north || south ? clamp(h0 + (o.alt ? dh * 2 : dh), o.range.min.h, o.range.max.h) / h0 : 1;
  const ax = o.alt ? 0 : east ? -w0 / 2 : west ? w0 / 2 : 0;
  const ay = o.alt ? 0 : south ? -h0 / 2 : north ? h0 / 2 : 0;
  const ux = (1 - sx) * ax;
  const uy = (1 - sy) * ay;
  return { ...start, w: w0 * sx, h: h0 * sy, cx: start.cx + ux * cos - uy * sin, cy: start.cy + ux * sin + uy * cos };
}

/** 四角的对角点（旋转之后）：缩放时它不动。 */
export function oppositeCorner(pose: Pose, handle: Handle): Point {
  const sx = handle.includes('w') ? 1 : -1;
  const sy = handle.includes('n') ? 1 : -1;
  return toCanvas(pose, (sx * pose.w) / 2, (sy * pose.h) / 2);
}

/** 一次等比缩放的倍率：按指针到锚点的距离比，夹在 0.1–5，且不把短边缩到 10 像素以下（本来就更小的不再缩）。 */
export function scaleFactor(anchor: Point, p0: Point, p: Point, shortSide: number): number {
  const d0 = Math.hypot(p0.x - anchor.x, p0.y - anchor.y);
  const d = Math.hypot(p.x - anchor.x, p.y - anchor.y);
  const lo = Math.min(1, Math.max(SCALE_MIN, MIN_PX / Math.max(shortSide, 1e-6)));
  return clamp(d / Math.max(d0, 1), lo, SCALE_MAX);
}

/** 盒绕一个点等比缩放：中心随之平移到 `anchor + (c0 − anchor) × f`，于是锚点那个位置不动。 */
export function scaleAbout(pose: Pose, anchor: Point, f: number): Pose {
  return {
    ...pose,
    w: pose.w * f,
    h: pose.h * f,
    cx: anchor.x + (pose.cx - anchor.x) * f,
    cy: anchor.y + (pose.cy - anchor.y) * f,
  };
}

/** 四角等比缩放（原型 `cornerScaleAbout`）：锚在对角，⌥ 锚在中心。 */
export function cornerScale(start: Pose, handle: Handle, p0: Point, p: Point, alt: boolean): { pose: Pose; factor: number } {
  const anchor = alt ? { x: start.cx, y: start.cy } : oppositeCorner(start, handle);
  const factor = scaleFactor(anchor, p0, p, Math.min(start.w, start.h));
  return { pose: scaleAbout(start, anchor, factor), factor };
}

// ---- 旋转 ----

/** 默认吸到 15° 栅格，`free`（⇧ / ⌥）时自由、保留一位小数。 */
export function snapRotation(degrees: number, free: boolean): number {
  const w = wrapRotation(degrees);
  if (free) return round1(w);
  const s = Math.round(w / ROT_STEP) * ROT_STEP;
  return s === -180 ? 180 : s === 0 ? 0 : s;
}

/** 指针相对枢轴的角度（度，12 点方向为 0，顺时针）。 */
export function pointerAngle(pivot: Point, p: Point): number {
  return (Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180) / Math.PI + 90;
}

/** 旋转手势：起手角度加上指针绕枢轴转过的角度。 */
export function dragRotation(start: number, pivot: Point, p0: Point, p: Point, free: boolean): number {
  return snapRotation(start + pointerAngle(pivot, p) - pointerAngle(pivot, p0), free);
}

// ---- 多选 ----

/** 整体平移：先把位移夹到全组都合法，再逐件加同一个位移（逐件各夹各的会把组拖变形）。 */
export function groupShift(starts: Pose[], limits: Limits[], dx: number, dy: number): Point {
  if (!starts.length) return { x: 0, y: 0 };
  let lo = -Infinity;
  let hi = Infinity;
  let lo2 = -Infinity;
  let hi2 = Infinity;
  starts.forEach((p, i) => {
    const l = limits[i];
    if (!l) return;
    lo = Math.max(lo, l.x[0] - p.cx);
    hi = Math.min(hi, l.x[1] - p.cx);
    lo2 = Math.max(lo2, l.y[0] - p.cy);
    hi2 = Math.min(hi2, l.y[1] - p.cy);
  });
  return { x: clamp(dx, Math.min(lo, 0), Math.max(hi, 0)), y: clamp(dy, Math.min(lo2, 0), Math.max(hi2, 0)) };
}

/** 一组盒的外包盒（各自旋转后的外包盒取并集）；空集是 null。 */
export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 整体等比缩放（原型 `groupScale`）：绕统一框的中心缩，每件的中心与尺寸同乘一个倍率。倍率按指针到中心的距离比
 * （把手跟手），夹在 0.1–5，且组里最小的那件短边不缩到 10 像素以下。
 */
export function groupScale(starts: Pose[], bounds: Rect, p0: Point, p: Point): { poses: Pose[]; factor: number } {
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const shortest = Math.min(...starts.map((s) => Math.min(s.w, s.h)));
  const factor = scaleFactor(center, p0, p, shortest);
  return { poses: starts.map((s) => scaleAbout(s, center, factor)), factor };
}

// ---- 键盘 ----

/**
 * 方向键微调（原型 editor-keys：1%，⇧ 5%，⌥↑/↓ 0.1%）：按画布宽 / 高的百分比。⌥←/→ 让给时间微调，返回 null。
 */
export function nudgeDelta(key: string, shift: boolean, alt: boolean, canvas: CanvasSize): Point | null {
  const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  const dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
  if (!dx && !dy) return null;
  if (alt && dx) return null;
  const step = alt ? 0.1 : shift ? 5 : 1;
  return { x: (dx * step * canvas.width) / 100, y: (dy * step * canvas.height) / 100 };
}

// ---- 框选 ----

/** 起手到此刻的矩形；`on` 是越过了 4px（以内仍算一次点击）。阈值用画面像素时传进来的点也得是画面像素。 */
export function marqueeRect(p0: Point, p1: Point, min = MARQUEE_MIN): Rect & { on: boolean } {
  const r = normRect({ x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y });
  return { ...r, on: Math.max(r.w, r.h) >= min };
}

export function normRect(r: Rect): Rect {
  return { x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) };
}

/** 两个盒相交（边贴边不算）。 */
export function rectsCross(a: Rect, b: Rect): boolean {
  const m = normRect(a);
  const n = normRect(b);
  return n.x < m.x + m.w && m.x < n.x + n.w && n.y < m.y + m.h && m.y < n.y + n.h;
}
