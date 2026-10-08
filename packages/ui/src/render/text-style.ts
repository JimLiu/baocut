/**
 * 旧样式（`baocut.legacy-studio-style/0.1` 的字幕与元素模型文字实例的 `style`）解成一行文字的画法。
 *
 * 照旧版渲染器（bcut-subtitle-render `resolve_line_style`）的口径：字号以 540 短边为基准随画布缩放，
 * 描边、阴影、底板留白都按这一行自己的字号折算。旧数据原样保存，所以这里读它的原始字段。
 */

export type Json = Record<string, unknown>;
export type LineKind = 'original' | 'translation';

/** Studio 字幕样式（旧版字幕的样式文档）的 schema。 */
export const STUDIO_STYLE = 'baocut.legacy-studio-style/0.1';

/** 颜色，`a` 是不透明度（0–1）。 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface LineStyle {
  /** CSS 的 font-family（已带回退）。 */
  fontFamily: string;
  /** 字号（序列像素）。 */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  color: string;
  letterSpacing: number;
  lineHeight: number;
  textTransform: string;
  textAlign: 'left' | 'center' | 'right';
  /** 描边：`width` 是整条居中线宽。 */
  outline: { color: string; width: number } | null;
  /** 阴影或发光（旧版两者共用一个槽位，发光优先）。 */
  effect: { color: string; x: number; y: number; blur: number } | null;
  /** 底板：`block` 是整块一张（否则逐行一张），`minWidth` 是它的最小宽。 */
  plate: { color: string; radius: number; block: boolean; minWidth: number } | null;
  /** 底板的横竖留白：底板关掉时照样撑开字幕行的槽位。 */
  padH: number;
  padV: number;
}

export const REFERENCE_SHORT_EDGE = 540;
const REFERENCE_FONT_SIZE = 30;
const DEFAULT_BILINGUAL_ORIG_SCALE = 20 / 30;
const DEFAULT_TRANSLATION_RATIO = 32 / 20;
const PLATE_PAD_ASPECT = 1.4;

const FONT_ALIASES: Record<string, string> = {
  montserrat: 'Montserrat',
  bebas: 'Bebas Neue',
  lexend: 'Lexend Deca',
  serif: 'Source Serif 4',
};
/** 本机没有的字体落到系统字体上；中文走苹方 / 思源黑体。 */
const FALLBACK = '"PingFang SC", "Noto Sans SC", system-ui, sans-serif';

export function fontStack(value: unknown): string {
  const raw = typeof value === 'string' ? value : isObject(value) && typeof value.fontFamily === 'string' ? value.fontFamily : 'system';
  const name = (FONT_ALIASES[raw] ?? raw).replace(/["\\{}\r\n]/g, '').trim();
  return !name || name === 'system' ? FALLBACK : `"${name}", ${FALLBACK}`;
}

/** 文字行的样式：根样式叠上 `origStyle` / `transStyle` 的覆盖。 */
export function mergedLineStyle(root: Json, kind: LineKind): Json {
  const overrides = root[kind === 'original' ? 'origStyle' : 'transStyle'];
  return isObject(overrides) ? { ...root, ...overrides } : root;
}

/**
 * 一行文字的画法。`canvas` 是序列画布；`compactOriginal` 是双语时原文按 `bilingualOrigScale` 缩小。
 */
export function resolveLineStyle(
  root: Json,
  kind: LineKind,
  canvas: { width: number; height: number },
  compactOriginal = false,
): LineStyle {
  const style = mergedLineStyle(root, kind);
  const basis = style.fontSizeBasis === 'height' ? canvas.height : Math.min(canvas.width, canvas.height);
  const canvasScale = (basis / REFERENCE_SHORT_EDGE) * Math.max(0.05, num(root.scale, 1));
  const overrides = root[kind === 'original' ? 'origStyle' : 'transStyle'];
  const explicit = isObject(overrides) && typeof overrides.fontSize === 'number' ? Math.max(1, overrides.fontSize) : null;
  const base = Math.max(1, num(root.fontSize, REFERENCE_FONT_SIZE));
  const bilingual = Math.max(0.1, num(root.bilingualOrigScale, DEFAULT_BILINGUAL_ORIG_SCALE));
  const logical =
    explicit ??
    (kind === 'translation'
      ? base * bilingual * Math.max(0.1, num(root.transScale, DEFAULT_TRANSLATION_RATIO))
      : compactOriginal
        ? base * bilingual
        : base);
  const fontSize = logical * canvasScale;

  const outline = asObject(style.textOutline);
  const legacyOutline = style.outline === true;
  const outlineColor = parseColor(outline.color) ?? { r: 0, g: 0, b: 0, a: 224 / 255 };
  const outlineOn =
    typeof outline.on === 'boolean'
      ? outline.on
      : typeof style.outline === 'boolean'
        ? style.outline
        : num(outline.width, 0) > 0 && visible(outlineColor);
  const outlineWidth = (Math.max(0, num(outline.width, legacyOutline ? 14 : 0)) * fontSize) / 100 / 2;

  const shadow = asObject(style.dropShadow);
  const shadowOn = typeof shadow.on === 'boolean' ? shadow.on : num(shadow.blur, 0) > 0 || num(shadow.distance, 0) > 0;
  const glow = asObject(style.glow);
  const glowOn = typeof glow.on === 'boolean' ? glow.on : num(glow.intensity, 0) > 0;
  let effect: LineStyle['effect'] = null;
  if (glowOn) {
    const color = { ...(parseColor(glow.color) ?? WHITE), a: num(glow.intensity, 50) / 100 };
    effect = { color: css(color), x: 0, y: 0, blur: Math.max(1, (num(glow.range, 40) / 100) * fontSize * 0.9) };
  } else if (shadowOn) {
    const distance = Math.max(0, num(shadow.distance, 0.04)) * fontSize;
    const angle = (num(shadow.rotation, 90) * Math.PI) / 180;
    const color = { ...(parseColor(shadow.color) ?? BLACK), a: clamp(num(shadow.opacity, legacyOutline ? 0.48 : 0.6), 0, 1) };
    effect = {
      color: css(color),
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      blur: Math.max(0, num(shadow.blur, legacyOutline ? 0.12 : 0.08)) * fontSize,
    };
  }

  const backgroundColor = parseColor(style.backgroundColor) ?? parseColor(root.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0.8 };
  const backgroundOn =
    typeof style.background === 'boolean'
      ? style.background
      : typeof style.bgOn === 'boolean'
        ? style.bgOn
        : visible(parseColor(style.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 });
  const block = style.backgroundStyle === 'block' && backgroundOn;
  const sizeScale = fontSize / REFERENCE_FONT_SIZE;
  const padH = Math.max(0, num(style.backgroundPadding, 10)) * sizeScale * 0.8;
  const padY = style.backgroundPaddingY;
  const padV = typeof padY === 'number' && Number.isFinite(padY) && padY >= 0 ? padY * sizeScale * 0.8 : padH / PLATE_PAD_ASPECT;
  const radius =
    typeof style.borderRadius === 'number' && Number.isFinite(style.borderRadius)
      ? Math.max(0, style.borderRadius) * sizeScale * 0.55
      : padH;

  let fontWeight = clamp(weightOf(style.fontWeight), 100, 900);
  if (style.bold === true) fontWeight = Math.max(fontWeight, 700);
  const align = style.textAlign ?? style.align;

  return {
    fontFamily: fontStack(style.fontFamily),
    fontSize,
    fontWeight,
    italic: style.italic === true || style.fontStyle === 'italic',
    underline: style.underline === true,
    color: css(parseColor(style.fontColor) ?? parseColor(root.fontColor) ?? WHITE),
    letterSpacing: num(style.letterSpacing, 0) * sizeScale,
    lineHeight: Math.max(0.5, num(style.lineHeight, 1.2)),
    textTransform: typeof style.textTransform === 'string' ? style.textTransform : '',
    textAlign: align === 'left' || align === 'right' ? align : 'center',
    outline: outlineOn && outlineWidth > 0 ? { color: css(outlineColor), width: outlineWidth } : null,
    effect,
    plate: backgroundOn ? { color: css(backgroundColor), radius, block, minWidth: block ? canvas.width * 0.28 : 0 } : null,
    padH,
    padV,
  };
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** `#rgb`、`#rgba`、`#rrggbb`、`#rrggbbaa`、`rgb()`、`rgba()` 与 `transparent`；认不出是 null。 */
export function parseColor(value: unknown): Rgba | null {
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

export function css({ r, g, b, a }: Rgba): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(a.toFixed(4))})`;
}

/** 文字的字形变换（`uppercase` / `lowercase` / `capitalize`）。 */
export function transformText(text: string, transform: string): string {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform === 'capitalize' || transform === 'title')
    return text.replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
  return text;
}

export function weightOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 400;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return { medium: 500, semibold: 600, bold: 700, extrabold: 800, heavy: 800, black: 900 }[value] ?? 400;
}

/** 旧版判断「看得见」的口径：透明度不到 252/255。 */
function visible(color: Rgba): boolean {
  return color.a > 3 / 255;
}

export function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asObject(value: unknown): Json {
  return isObject(value) ? value : {};
}
