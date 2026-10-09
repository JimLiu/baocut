import type { AssetRecord, Id, Sequence } from '@baocut/protocol';
import { ratioCanvas } from './property-values.ts';
import { primaryMedia } from './stage-media.ts';

/**
 * 舞台下沿工具条（原型 stage.jsx 的 `StageBar`；画布上选中元素时浮出的是另一条，见 stage-toolbar.ts）的判据：
 * 画幅表与当前是哪一档、自定义画幅、竖幅的平台安全区。不碰 React。
 */

export interface StageRatio {
  key: string;
  w: number;
  h: number;
}

/** 画幅表（原型 data.js `ratios`，「原始」另算）：短边不变换长边，与检查器的画幅同一种换法（`ratioCanvas`）。 */
export const STAGE_RATIOS: readonly StageRatio[] = [
  { key: '16:9', w: 16, h: 9 },
  { key: '9:16', w: 9, h: 16 },
  { key: '1:1', w: 1, h: 1 },
  { key: '4:3', w: 4, h: 3 },
  { key: '3:4', w: 3, h: 4 },
  { key: '2:1', w: 2, h: 1 },
  { key: '2.35:1', w: 2.35, h: 1 },
  { key: '1.85:1', w: 1.85, h: 1 },
];
export const ORIGINAL_RATIO = 'original';

/** 引擎收的画布边长上限（crates/video-engine `MAX_CANVAS_SIDE`）。 */
export const CANVAS_SIDE_MAX = 16_384;

type Size = { width: number; height: number };

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** 「原始」：主媒体里第一段视频的显示尺寸；没有视频（纯音频、图片、空的）时 null，菜单里这一档灰着。 */
export function sourceSize(sequence: Sequence, assets: Record<Id, AssetRecord>): Size | null {
  for (const media of primaryMedia(sequence)) {
    if (media.kind !== 'video') continue;
    const video = assets[media.ref.id]?.revisions[media.ref.revision]?.video;
    if (video && video.displayWidth > 0 && video.displayHeight > 0) return { width: video.displayWidth, height: video.displayHeight };
  }
  return null;
}

/** 画布现在是哪一档：表里的优先（钮上写比例比写「原始」有用），都不是再看是不是原始比例；都不是 null（自定义）。 */
export function stageRatioOf(canvas: Size, original: Size | null): string | null {
  const ratio = canvas.width / canvas.height;
  const named = STAGE_RATIOS.find((r) => near(r.w / r.h, ratio));
  if (named) return named.key;
  return original && near(original.width / original.height, ratio) ? ORIGINAL_RATIO : null;
}

/** 钮上的字：表里的写那一档；别的约成最简整数比，约不小（如 1778:1000）写成 `1.78:1`。 */
export function ratioText(canvas: Size): string {
  const named = STAGE_RATIOS.find((r) => near(r.w / r.h, canvas.width / canvas.height));
  if (named) return named.key;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(Math.round(canvas.width), Math.round(canvas.height)) || 1;
  const w = Math.round(canvas.width) / d;
  const h = Math.round(canvas.height) / d;
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  const r = canvas.width / canvas.height;
  return r >= 1 ? `${trim(r)}:1` : `1:${trim(1 / r)}`;
}

const trim = (n: number) => String(Math.round(n * 100) / 100);

/** 选一档要换成的画布；「原始」没有视频时 null。 */
export function stageRatioCanvas(canvas: Size, key: string, original: Size | null): Size | null {
  if (key === ORIGINAL_RATIO) return original ? ratioCanvas(canvas, original.width, original.height) : null;
  const ratio = STAGE_RATIOS.find((r) => r.key === key);
  return ratio ? ratioCanvas(canvas, ratio.w, ratio.h) : null;
}

export type CustomRatio = { ok: true; canvas: Size } | { ok: false; reason: 'invalid' | 'tooLong' };

/** 自定义画幅（原型「自定义…」对话框的两个数）：都要是正数；短边不变换出来的长边不能超过引擎的上限。 */
export function customRatio(canvas: Size, w: number, h: number): CustomRatio {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { ok: false, reason: 'invalid' };
  const next = ratioCanvas(canvas, w, h);
  return next.width > CANVAS_SIDE_MAX || next.height > CANVAS_SIDE_MAX ? { ok: false, reason: 'tooLong' } : { ok: true, canvas: next };
}

/** 竖幅：平台安全区只对它有意义（原型 model-shorts.js `isPortrait`）。 */
export function isPortrait(canvas: Size): boolean {
  return canvas.height > canvas.width;
}

// ---- 平台安全区（原型 model-shorts.js `SAFE` / `zones` / `safeBox`）----

/** 竖屏平台的界面遮住的地方，占画面的百分比。原型那边是唯一的数字来源，改要两边一起改。 */
export const SAFE_AREA = { top: 8, right: 18, bottom: 24, side: 6 } as const;

export type SafeZoneKey = 'top' | 'right' | 'bottom';
export interface SafeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 三块遮挡区：顶部状态栏、右侧按钮列、底部文案与评论。右侧那一列夹在上下两块之间，不重叠。 */
export function safeZones(): Array<SafeRect & { key: SafeZoneKey }> {
  const { top, right, bottom } = SAFE_AREA;
  return [
    { key: 'top', x: 0, y: 0, w: 100, h: top },
    { key: 'right', x: 100 - right, y: top, w: right, h: 100 - top - bottom },
    { key: 'bottom', x: 0, y: 100 - bottom, w: 100, h: bottom },
  ];
}

/** 虚线框：不被挡住、放字放人都安全的那块。 */
export function safeBox(): SafeRect {
  const { top, right, bottom, side } = SAFE_AREA;
  return { x: side, y: top, w: 100 - side - right, h: 100 - top - bottom };
}

