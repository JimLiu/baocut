import { engineRanges } from '@baocut/editor-wasm';
import type { Rate, ShapeProps } from '@baocut/protocol';
import { STUDIO_STYLE, asObject, parseColor, type Json } from '../render/text-style.ts';
import { CLASSIC, CLASSIC_WORD_ANIMATION } from './caption-presets.ts';

/** 属性页里数值与落盘字段之间的换算：变速、音量、画幅、颜色，以及整体替换的样式对象怎么补丁。 */

// ---- 变速 ----

/** 界面上的变速范围（引擎接受 0.1–10）。 */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 倍速 → 约分的速率：先取到两位小数（1.5 → 3/2，0.25 → 1/4，0.33 → 33/100）。 */
export function rateFromSpeed(speed: number): Rate {
  const num = Math.round(speed * 100);
  const g = gcd(num, 100);
  return { num: num / g, den: 100 / g };
}

export function speedOf(rate: Rate): number {
  return rate.num / rate.den;
}

// ---- 音量 ----

/** dB 读数的下限：再低就显示 −∞。 */
export const GAIN_MIN_DB = -96;
/** 引擎接受的音量上限（线性倍数；`editor-wasm` 的取值区间）。用到时才读 WASM，模块载入时不碰它。 */
const volumeMax = (): number => engineRanges().volume[1];

/** 音量（线性倍数）→ 百分比（1 = 100%），取整。 */
export function percentFromVolume(volume: number): number {
  return Math.round(Math.min(volumeMax(), Math.max(0, volume)) * 100);
}

/** 音量百分比 → 线性倍数，夹在 0 到引擎的上限。 */
export function volumeFromPercent(percent: number): number {
  if (!(percent > 0)) return 0;
  return Math.min(volumeMax(), percent / 100);
}

/** 行尾的 dB 读数（音量用 `volumeToDb` 换算后传进来）。 */
export function formatDb(db: number): string {
  if (db <= GAIN_MIN_DB) return '−∞ dB';
  const rounded = Math.round(db * 10) / 10;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(1)} dB`;
}

// ---- 画幅 ----

export const ASPECTS = [
  { key: '16:9', w: 16, h: 9 },
  { key: '9:16', w: 9, h: 16 },
  { key: '1:1', w: 1, h: 1 },
  { key: '4:3', w: 4, h: 3 },
] as const;
export type AspectKey = (typeof ASPECTS)[number]['key'];

/** 换画幅：短边不变，长边按比例取到偶数（编码器要偶数尺寸）。 */
export function aspectCanvas(canvas: { width: number; height: number }, key: AspectKey): { width: number; height: number } {
  const aspect = ASPECTS.find((a) => a.key === key)!;
  return ratioCanvas(canvas, aspect.w, aspect.h);
}

/** 换成任意 `w:h`（舞台工具条的画幅表、自定义画幅）：同 `aspectCanvas`，短边不变，长边取偶数。 */
export function ratioCanvas(canvas: { width: number; height: number }, w: number, h: number): { width: number; height: number } {
  const short = Math.min(canvas.width, canvas.height);
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return w >= h ? { width: even((short * w) / h), height: short } : { width: short, height: even((short * h) / w) };
}

/** 画布是哪一种画幅；都不是返回 null。 */
export function aspectOf(canvas: { width: number; height: number }): AspectKey | null {
  const ratio = canvas.width / canvas.height;
  return ASPECTS.find((a) => Math.abs(a.w / a.h - ratio) < 0.01)?.key ?? null;
}

// ---- 颜色 ----

/** 颜色拆成 `#RRGGBB` 与不透明度（0–1）；认不出时用 `fallback`。 */
export function colorParts(value: unknown, fallback: string): { hex: string; alpha: number } {
  const rgba = parseColor(value) ?? parseColor(fallback) ?? { r: 0, g: 0, b: 0, a: 1 };
  const byte = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return { hex: `#${byte(rgba.r)}${byte(rgba.g)}${byte(rgba.b)}`.toUpperCase(), alpha: rgba.a };
}

/** 不透明时写六位，否则写八位 `#RRGGBBAA`。 */
export function colorString(hex: string, alpha: number): string {
  const base = hex.slice(0, 7).toUpperCase();
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return a >= 255 ? base : `${base}${a.toString(16).padStart(2, '0').toUpperCase()}`;
}

/** 换掉颜色的不透明度，色相不变。 */
export function withAlpha(value: unknown, alpha: number, fallback: string): string {
  return colorString(colorParts(value, fallback).hex, alpha);
}

// ---- 整体替换的对象 ----

/** 文字样式补丁：`style` 整体替换，补丁叠在原对象上。 */
export function patchTextStyle(style: unknown, patch: Json): Json {
  return { ...asObject(style), ...patch };
}

/** 图形补丁：同上；没有种类时按矩形。 */
export function patchShape(shape: ShapeProps | undefined, patch: Json): ShapeProps {
  return { shape: 'rect', ...shape, ...patch } as ShapeProps;
}

/** 嵌套一层的字段（`dropShadow.on`、`glow.color`……）：只换这一层里给出的键。 */
export function nested(style: unknown, group: string, patch: Json): Json {
  return { [group]: { ...asObject(asObject(style)[group]), ...patch } };
}

/** 文字样式能不能在属性页里改：元素模型的文字样式不带 schema；带着别的 schema 的对象只读。 */
export function editableTextStyle(style: unknown): boolean {
  return asObject(style).schema === undefined;
}

// ---- 字幕样式文档 ----

/**
 * 默认预设（视频格式规范 §5.6「默认预设」）：没有样式文档的字幕按这份画（预览与导出的内核同一份，
 * `video_model::caption_style::default_studio_style`），新建字幕样式也种这一份。涂装是「经典」，`punct: true` 让逗号、
 * 句号换成空格。流程那份在 `packages/jobs/src/pipelines/caption-layer.ts`，三处一起改。
 */
export const DEFAULT_CAPTION_STYLE: Json = { schema: STUDIO_STYLE, style: { ...CLASSIC, wordAnimation: CLASSIC_WORD_ANIMATION, punct: true } };

/** Studio 字幕样式的根对象；别的 schema 返回 null（属性页只读）。 */
export function captionStyleRoot(body: unknown): Json | null {
  const doc = asObject(body);
  return doc.schema === STUDIO_STYLE ? asObject(doc.style) : null;
}

/** 字幕样式补丁：正文里别的字段原样保留，`style` 根对象叠上补丁。 */
export function patchCaptionStyle(body: unknown, patch: Json): Json {
  const doc = asObject(body);
  return { ...doc, schema: STUDIO_STYLE, style: { ...asObject(doc.style), ...patch } };
}

// ---- 时间 ----

/** 秒 → 十进制字符串（三位小数以内，去掉尾零），给淡入淡出这类以秒提交的字段。 */
export function decimalSeconds(seconds: number): string {
  return String(Math.round(Math.max(0, seconds) * 1000) / 1000);
}
