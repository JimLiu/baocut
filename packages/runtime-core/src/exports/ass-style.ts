/**
 * 字幕样式 → ASS 的 `[V4+ Styles]`（基础映射）。认得的是预览在用的 `baocut.legacy-studio-style/0.1`
 * （口径同 `packages/ui/src/render/text-style.ts`：字号以 540 短边为基准随画布缩放）：字体、字号、颜色、粗斜体与下划线、
 * 字距、描边、阴影、底板（ASS 的不透明框）、水平对齐、位置与宽度。ASS 表达不了的（发光、字形变换、行高、圆角、
 * 逐行底板、显示时机、标点处理……）与认不出的样式整份列在 `unmapped` 里，由导出写进报告，不静默丢弃。
 */

import { RcExport } from '@baocut/protocol/messages/runtime-core';

type Json = Record<string, unknown>;

const STUDIO_STYLE = 'baocut.legacy-studio-style/0.1';
const REFERENCE_SHORT_EDGE = 540;
const REFERENCE_FONT_SIZE = 30;
const DEFAULT_BILINGUAL_ORIG_SCALE = 20 / 30;
const DEFAULT_TRANSLATION_RATIO = 32 / 20;
const FONT_ALIASES: Record<string, string> = {
  montserrat: 'Montserrat',
  bebas: 'Bebas Neue',
  lexend: 'Lexend Deca',
  serif: 'Source Serif 4',
};
const SYSTEM_FONT = 'PingFang SC';
/** 映射了的字段；其余出现了的字段列为未映射。 */
const MAPPED = new Set([
  'fontFamily',
  'fontSize',
  'fontColor',
  'fontWeight',
  'bold',
  'italic',
  'fontStyle',
  'underline',
  'letterSpacing',
  'textOutline',
  'outline',
  'dropShadow',
  'background',
  'bgOn',
  'backgroundColor',
  'textAlign',
  'align',
  'scale',
  'width',
  'x',
  'y',
  'order',
  'origStyle',
  'transStyle',
  'bilingualOrigScale',
  'transScale',
  'fontSizeBasis',
]);

export interface AssStyleMapping {
  styles: { default: string; translation: string };
  /** 译文排在原文上面（`order: 'trans'`，预览的默认）。 */
  translationFirst: boolean;
  unmapped: string[];
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** CSS 颜色 → `&HAABBGGRR`（ASS 的 alpha 是透明度：00 不透明）。认不出时用 `fallback`。 */
export function assColor(value: unknown, fallback: string, alpha?: number): string {
  const rgba = parseColor(value);
  if (!rgba) return fallback;
  const a = Math.round((1 - clamp(alpha ?? rgba.a, 0, 1)) * 255);
  const hex = (n: number) =>
    Math.round(clamp(n, 0, 255))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `&H${hex(a)}${hex(rgba.b)}${hex(rgba.g)}${hex(rgba.r)}`;
}

function parseColor(value: unknown): { r: number; g: number; b: number; a: number } | null {
  if (typeof value !== 'string') return null;
  const input = value.trim().toLowerCase();
  if (input === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (input.startsWith('#')) {
    let hex = input.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if ((hex.length !== 6 && hex.length !== 8) || !/^[0-9a-f]+$/.test(hex)) return null;
    const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: hex.length === 8 ? byte(6) / 255 : 1 };
  }
  const match = /^rgba?\(([^)]*)\)$/.exec(input);
  if (!match) return null;
  const parts = match[1]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: clamp(parts[3] ?? 1, 0, 1) };
}

function fontName(value: unknown): string {
  const raw = typeof value === 'string' ? value : 'system';
  const name = (FONT_ALIASES[raw] ?? raw).replace(/[,\r\n]/g, '').trim();
  return !name || name === 'system' ? SYSTEM_FONT : name;
}

function styleLine(
  name: string,
  root: Json,
  kind: 'original' | 'translation',
  canvas: { width: number; height: number },
  bilingual: boolean,
): string {
  const overrides = root[kind === 'original' ? 'origStyle' : 'transStyle'];
  const style: Json = isObject(overrides) ? { ...root, ...overrides } : root;
  const basis = style.fontSizeBasis === 'height' ? canvas.height : Math.min(canvas.width, canvas.height);
  const canvasScale = (basis / REFERENCE_SHORT_EDGE) * Math.max(0.05, num(root.scale, 1));
  const base = Math.max(1, num(root.fontSize, REFERENCE_FONT_SIZE));
  const explicit = isObject(overrides) && typeof overrides.fontSize === 'number' ? Math.max(1, overrides.fontSize) : null;
  const compact = Math.max(0.1, num(root.bilingualOrigScale, DEFAULT_BILINGUAL_ORIG_SCALE));
  const logical =
    explicit ??
    (kind === 'translation'
      ? base * compact * Math.max(0.1, num(root.transScale, DEFAULT_TRANSLATION_RATIO))
      : bilingual
        ? base * compact
        : base);
  const fontSize = logical * canvasScale;
  const sizeScale = fontSize / REFERENCE_FONT_SIZE;

  const outline = isObject(style.textOutline) ? style.textOutline : {};
  const legacyOutline = style.outline === true;
  const outlineColor = parseColor(outline.color) ?? { r: 0, g: 0, b: 0, a: 224 / 255 };
  const outlineOn =
    typeof outline.on === 'boolean'
      ? outline.on
      : typeof style.outline === 'boolean'
        ? style.outline
        : num(outline.width, 0) > 0 && outlineColor.a > 0.01;
  const outlineWidth = outlineOn ? (Math.max(0, num(outline.width, legacyOutline ? 14 : 0)) * fontSize) / 100 / 2 : 0;

  const shadow = isObject(style.dropShadow) ? style.dropShadow : {};
  const shadowOn = typeof shadow.on === 'boolean' ? shadow.on : num(shadow.blur, 0) > 0 || num(shadow.distance, 0) > 0;
  const backgroundOn =
    typeof style.background === 'boolean'
      ? style.background
      : typeof style.bgOn === 'boolean'
        ? style.bgOn
        : (parseColor(style.backgroundColor)?.a ?? 0) > 0.01;

  const weight =
    typeof style.fontWeight === 'number'
      ? style.fontWeight
      : ({ bold: 700, semibold: 600, black: 900, heavy: 800 }[String(style.fontWeight)] ?? 400);
  const bold = style.bold === true || weight >= 600 ? -1 : 0;
  const italic = style.italic === true || style.fontStyle === 'italic' ? -1 : 0;
  const underline = style.underline === true ? -1 : 0;
  const align = style.textAlign ?? style.align;
  const alignment = align === 'left' ? 1 : align === 'right' ? 3 : 2;
  const marginLR = Math.round((canvas.width * (100 - clamp(num(root.width, 80), 5, 100))) / 200);
  const marginV = Math.max(0, Math.round((canvas.height * (100 - num(root.y, 86))) / 100 - (fontSize * 1.2) / 2));

  const primary = assColor(style.fontColor ?? root.fontColor, '&H00FFFFFF');
  const outlineAss = assColor(outline.color, '&H1F000000');
  let back = '&H80000000';
  let borderStyle = 1;
  let shadowDepth = 0;
  if (backgroundOn) {
    // 不透明框：ASS 用描边色画框。
    borderStyle = 3;
    back = assColor(style.backgroundColor ?? root.backgroundColor, '&H33000000');
  } else if (shadowOn) {
    back = assColor(shadow.color, '&H66000000', clamp(num(shadow.opacity, 0.6), 0, 1));
    shadowDepth = Math.max(0, num(shadow.distance, 0.04)) * fontSize;
  }
  const boxOutline = backgroundOn ? back : outlineAss;
  const fields = [
    name,
    fontName(style.fontFamily),
    fontSize.toFixed(1),
    primary,
    '&H000000FF',
    boxOutline,
    back,
    bold,
    italic,
    underline,
    0,
    100,
    100,
    (num(style.letterSpacing, 0) * sizeScale).toFixed(1),
    0,
    borderStyle,
    (backgroundOn ? Math.max(1, Math.max(0, num(style.backgroundPadding, 10)) * sizeScale * 0.8) : outlineWidth).toFixed(1),
    shadowDepth.toFixed(1),
    alignment,
    marginLR,
    marginLR,
    marginV,
    1,
  ];
  return `Style: ${fields.join(',')}`;
}

/** 样式文档的正文（可能为 null）→ ASS 的两个样式（原文 `Default`、译文 `Translation`）与未映射的字段。 */
export function assStyleMapping(body: unknown, canvas: { width: number; height: number }): AssStyleMapping {
  const unmapped: string[] = [];
  let root: Json = {};
  if (body !== null && body !== undefined) {
    const doc: Json = isObject(body) ? body : {};
    const schema = doc.schema;
    if (schema === STUDIO_STYLE && isObject(doc.style)) {
      root = doc.style;
      const seen = new Set<string>();
      const collect = (style: Json, prefix: string) => {
        for (const [key, value] of Object.entries(style)) {
          if (value === undefined || value === null || value === false || MAPPED.has(key)) continue;
          if (isObject(value) && value.on === false) continue;
          const label = `${prefix}${key}`;
          if (!seen.has(label)) {
            seen.add(label);
            unmapped.push(label);
          }
        }
      };
      collect(root, '');
      for (const kind of ['origStyle', 'transStyle'] as const) if (isObject(root[kind])) collect(root[kind], `${kind}.`);
      if (num(root.x, 50) !== 50) unmapped.push('x');
      if (isObject(root.dropShadow) && root.dropShadow.on !== false && num(root.dropShadow.blur, 0) > 0) unmapped.push('dropShadow.blur');
    } else {
      unmapped.push(RcExport.assWholeStyle({ schema: typeof schema === 'string' ? schema : null }).text);
    }
  }
  return {
    styles: {
      default: styleLine('Default', root, 'original', canvas, false),
      translation: styleLine('Translation', root, 'translation', canvas, true),
    },
    translationFirst: (root.order ?? 'trans') === 'trans',
    unmapped,
  };
}
