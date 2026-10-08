import { defineMessages, live } from '@baocut/protocol';
import type { Pose } from './stage-pose.ts';
import { zhHans } from './geometry-panel.zh-Hans.ts';
import { zhHant } from './geometry-panel.zh-Hant.ts';
import { ja } from './geometry-panel.ja.ts';
import { ko } from './geometry-panel.ko.ts';
import { es } from './geometry-panel.es.ts';
import { fr } from './geometry-panel.fr.ts';
import { de } from './geometry-panel.de.ts';
import { nl } from './geometry-panel.nl.ts';
import { ptBR } from './geometry-panel.pt-BR.ts';
import { it } from './geometry-panel.it.ts';
import { ru } from './geometry-panel.ru.ts';
import { pl } from './geometry-panel.pl.ts';
import { tr } from './geometry-panel.tr.ts';
import { vi } from './geometry-panel.vi.ts';

/** 几何段的文案（英文是键与类型的来源，译文在 `geometry-panel.zh-Hans.ts`）。 */
const en = {
  x: { left: 'From left', center: 'Horizontal offset', right: 'From right' } as Record<PinX, string>,
  y: { top: 'From top', middle: 'Vertical offset', bottom: 'From bottom' } as Record<PinY, string>,
  pins: {
    'left top': 'Top-left corner',
    'center top': 'Top edge center',
    'right top': 'Top-right corner',
    'left middle': 'Left edge center',
    'center middle': 'Center',
    'right middle': 'Right edge center',
    'left bottom': 'Bottom-left corner',
    'center bottom': 'Bottom edge center',
    'right bottom': 'Bottom-right corner',
  } as Record<`${PinX} ${PinY}`, string>,
};
export type GeometryPanelMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 属性页的几何段：位置 · 大小 · 九宫钉点（照原型 model-geometry.js 与 baocut-app 的 geometry_panel）。
 *
 * 面板读的是实例的盒（`stage-pose` 的 `poseOf`：由 `place` 按种类推出的中心与像素宽高），先换成画布百分比、左上原点的
 * 盒子 `{l, t, w, h}`，再按钉点投成四个数 X / Y / W / H：
 *
 *   X = l               钉左      X = (l + w/2) − 50   钉中（0 = 居中）      X = 100 − (l + w)   钉右
 *   Y = t               钉顶      Y = (t + h/2) − 50   钉中                  Y = 100 − (t + h)   钉底
 *
 * 只在提交某个字段时反投影；没改的轴沿用未取整的原值，所以打开面板、换钉点都不漂。钉点不落盘。
 */

export type PinX = 'left' | 'center' | 'right';
export type PinY = 'top' | 'middle' | 'bottom';
export interface Pin {
  x: PinX;
  y: PinY;
}
/** 画布百分比、左上原点。 */
export interface CanvasBox {
  l: number;
  t: number;
  w: number;
  h: number;
}
/** 面板上的四个数（画布百分比）。 */
export interface PanelValues {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Canvas = { width: number; height: number };
/** 盒的中心与尺寸（画布像素）；落盘时经 `placeFields` 换成 `place`。 */
export type BoxFields = Pick<Pose, 'cx' | 'cy' | 'w' | 'h'>;
export type QuickAction = 'snapToPin' | 'fullWidth' | 'fullHeight';

export const PIN_X: readonly PinX[] = ['left', 'center', 'right'];
export const PIN_Y: readonly PinY[] = ['top', 'middle', 'bottom'];
export const X_LABEL: Record<PinX, string> = live(() => M.x);
export const Y_LABEL: Record<PinY, string> = live(() => M.y);
export const PIN_NAMES: Record<`${PinX} ${PinY}`, string> = live(() => M.pins);

const EPS = 1e-9;
/** 框最窄：画布宽的 2%，且不少于 10 像素；最矮 0.1%。 */
const MIN_W = 2;
const MIN_PX = 10;
const MIN_H = 0.1;

/** 远离零取整到 1/k（与 Rust 的 f64::round 一致；JS 的 Math.round 负半数会差一格）。 */
function roundTo(value: number, k: number): number {
  const r = (Math.sign(value) * Math.round(Math.abs(value) * k)) / k;
  return r === 0 ? 0 : r;
}
export const round1 = (value: number) => roundTo(value, 10);

const sideX = (pin: PinX) => (pin === 'left' ? -1 : pin === 'right' ? 1 : 0);
const sideY = (pin: PinY) => (pin === 'top' ? -1 : pin === 'bottom' ? 1 : 0);

function axisProject(start: number, size: number, side: number): number {
  if (side < 0) return start;
  if (side > 0) return 100 - (start + size);
  return start + size / 2 - 50;
}
function axisUnproject(value: number, size: number, side: number): number {
  if (side < 0) return value;
  if (side > 0) return 100 - size - value;
  return value + 50 - size / 2;
}

/** 盒（未旋转）→ 画布盒。 */
export function boxOf(pose: Pose, canvas: Canvas): CanvasBox {
  const { width: W, height: H } = canvas;
  return { l: ((pose.cx - pose.w / 2) / W) * 100, t: ((pose.cy - pose.h / 2) / H) * 100, w: (pose.w / W) * 100, h: (pose.h / H) * 100 };
}

/** 画布盒 → 盒的中心与尺寸（画布像素）。 */
export function fieldsOf(box: CanvasBox, canvas: Canvas): BoxFields {
  const { width: W, height: H } = canvas;
  const w = (box.w / 100) * W;
  const h = (box.h / 100) * H;
  return { cx: (box.l / 100) * W + w / 2, cy: (box.t / 100) * H + h / 2, w, h };
}

export function projectRaw(box: CanvasBox, pin: Pin): PanelValues {
  return { x: axisProject(box.l, box.w, sideX(pin.x)), y: axisProject(box.t, box.h, sideY(pin.y)), w: box.w, h: box.h };
}

/** 面板显示的四个数（一位小数）。 */
export function project(box: CanvasBox, pin: Pin): PanelValues {
  const v = projectRaw(box, pin);
  return { x: round1(v.x), y: round1(v.y), w: round1(v.w), h: round1(v.h) };
}

/** 离哪条线（起边 / 中线 / 终边）最近；平手取靠前的（左 / 顶）。 */
function nearest(start: number, size: number): number {
  const d = [Math.abs(start), Math.abs(start + size / 2 - 50), Math.abs(100 - start - size)];
  let best = 0;
  for (let i = 1; i < 3; i += 1) if (d[i]! < d[best]! - EPS) best = i;
  return best;
}

/** 第一次打开时的钉点：横竖各取离得最近的那条线。 */
export function defaultPin(box: CanvasBox): Pin {
  return { x: PIN_X[nearest(box.l, box.w)]!, y: PIN_Y[nearest(box.t, box.h)]! };
}

const changed = (target: number, shown: number) => Math.abs(target - shown) > EPS;

/**
 * 提交面板上的值：只有和显示值不同的字段算改了。锁定比例时只改宽（或高）就按比例带上另一边。
 * 尺寸变了而位置没改，位置按钉点量的那个数保持不变（钉右的框变宽，往左长）。
 */
export function applyPanel(pose: Pose, canvas: Canvas, pin: Pin, target: PanelValues, lockRatio: boolean): BoxFields {
  const cur = boxOf(pose, canvas);
  const shown = project(cur, pin);
  const raw = projectRaw(cur, pin);
  const dx = changed(target.x, shown.x);
  const dy = changed(target.y, shown.y);
  const dw = changed(target.w, shown.w);
  const dh = changed(target.h, shown.h);
  const minW = Math.max(MIN_W, (MIN_PX / Math.max(canvas.width, EPS)) * 100);
  let w = dw ? target.w : cur.w;
  let h = dh ? target.h : cur.h;
  if (lockRatio && cur.w > 0 && cur.h > 0) {
    if (dw && !dh) h = (cur.h * w) / cur.w;
    else if (dh && !dw) w = (cur.w * h) / cur.h;
  }
  w = Math.max(w, minW);
  h = Math.max(h, MIN_H);
  const l = dx || changed(w, cur.w) ? axisUnproject(dx ? target.x : raw.x, w, sideX(pin.x)) : cur.l;
  const t = dy || changed(h, cur.h) ? axisUnproject(dy ? target.y : raw.y, h, sideY(pin.y)) : cur.t;
  const next = fieldsOf({ l, t, w, h }, canvas);
  // 没改的那一维原样留着，不因为来回换算多出浮点漂移。
  return {
    cx: dx || changed(w, cur.w) ? next.cx : pose.cx,
    cy: dy || changed(h, cur.h) ? next.cy : pose.cy,
    w: changed(w, cur.w) ? next.w : pose.w,
    h: changed(h, cur.h) ? next.h : pose.h,
  };
}

/** 快捷动作 → 新钉点与目标面板值：贴齐钉点（位置归零）、整宽（钉左、宽 100）、整高（钉顶、高 100）。 */
export function quick(pin: Pin, values: PanelValues, action: QuickAction): { pin: Pin; values: PanelValues } {
  if (action === 'fullWidth') return { pin: { x: 'left', y: pin.y }, values: { ...values, x: 0, w: 100 } };
  if (action === 'fullHeight') return { pin: { x: pin.x, y: 'top' }, values: { ...values, y: 0, h: 100 } };
  return { pin, values: { ...values, x: 0, y: 0 } };
}

/**
 * 适应画布 / 填满画布（baocut-app 元素工具条）：等比缩放到正好装进画布（或正好盖住画布），并摆回正中。
 */
export function fitCanvas(pose: Pose, canvas: Canvas, fill: boolean): BoxFields {
  const sx = canvas.width / pose.w;
  const sy = canvas.height / pose.h;
  const k = fill ? Math.max(sx, sy) : Math.min(sx, sy);
  return { cx: canvas.width / 2, cy: canvas.height / 2, w: pose.w * k, h: pose.h * k };
}

/** 旋转角折回 (−180, 180]。 */
export function wrapRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const r = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}
