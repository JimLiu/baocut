import { STUDIO_STYLE, asObject, isObject, num, parseColor, weightOf, type Json } from '../render/text-style.ts';
import { SEQUENCE_STYLE_ID, normalizeSequence, parseSequence, sequenceWordAnimation, type SequenceOptions } from './caption-sequence-style.ts';
import {
  SPOKEN_PRESETS,
  designedCaptionOf,
  normalizeActive,
  parseWordAnimation,
  wordAnimationOf,
  type ActiveWord,
  type SpokenEntrance,
} from './caption-word-animation.ts';

/**
 * 字幕样式的新正文（字幕样式模型设计 `docs/design/subtitle/caption-style-model-design.md` §3–§6）与它到 Studio 样式
 * （`baocut.legacy-studio-style/0.1` 的根对象，渲染内核读的那一份）的编译（§8）。
 *
 * 落盘的仍是 Studio 样式：属性页与画廊先把根对象解成正文（`parseStudioStyle`），改一个维度，再编译回去
 * （`compileCaptionStyle`）。解析是「尽力」的：正文表达不了的键原样留在 `legacy.keys`；编译结果与原值对不上的映射键
 * 记进 `legacy.overrides`（原值 ＋ 当时编译出的值），只要正文没改到那一键，编译时原样写回——所以
 * `compile(parse(root))` 与 `root` 逐键相等，改一个维度也只动那个维度派生的键。
 */

export const CAPTION_STYLE_SCHEMA = 'baocut.caption-style/1';

export type { ActiveWord } from './caption-word-animation.ts';
export type { SequenceOptions } from './caption-sequence-style.ts';

export type Casing = 'none' | 'upper' | 'lower' | 'title';
export type Align = 'left' | 'center' | 'right';

export interface Typography {
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  /** 字号占画布短边的比例（参考短边 540）。 */
  size: number;
  lineHeight: number;
  /** em，可为负。 */
  letterSpacing: number;
  casing: Casing;
  align: Align;
}

export interface Surface {
  color: string;
  /** `width` 为 em。 */
  stroke?: { color: string; width: number };
  /** em；`opacity`（0–1）是对设计稿的补充：Studio 的阴影色与不透明度分开存。 */
  shadow?: { color: string; offset: [number, number]; blur: number; opacity?: number };
  glow?: { color: string; intensity: number; range: number };
  plate?: { mode: 'line' | 'block'; color: string; opacity: number; padding: [number, number]; radius: number };
  wordBox?: { color: string; padding: [number, number]; radius: number };
}

export interface Layout {
  mode: 'line' | 'sequence';
  anchor: 'top' | 'center' | 'bottom';
  y: number;
  width: number;
  maxLines: 1 | 2 | 3;
  sequence?: SequenceOptions;
}

export type MotionStage = 'in' | 'out' | 'loop';
export type MotionUnit = 'cue' | 'line' | 'word' | 'grapheme';
export type MotionTrigger = 'enter' | 'spoken';

export interface MotionEffect {
  preset: string;
  unit: MotionUnit;
  trigger: MotionTrigger;
  durationSeconds: number;
  staggerSeconds?: number;
  intensity: number;
  easing: string;
  order?: 'forward' | 'backward' | 'center' | 'random';
  seed?: number;
  tilt?: boolean;
}

export type Motion = Partial<Record<MotionStage, MotionEffect>>;

export interface EmphasisLook {
  color?: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  scale: number;
}

export interface CaptionStyleLegacy {
  /** 正文不认识的根键，原样回写。 */
  keys: Json;
  /** 映射键里编译不出原值的：`value` 是原值（没有这个属性 = 原来没有这一键），`derived` 是当时编译出的值。 */
  overrides: Record<string, { value?: unknown; derived?: unknown }>;
}

export interface CaptionStyleBody {
  schema: typeof CAPTION_STYLE_SCHEMA;
  typography: Typography;
  surface: Surface;
  layout: Layout;
  activeWord: ActiveWord;
  motion?: Motion;
  emphasis?: EmphasisLook;
  preset?: { id: string; revision: number };
  legacy?: CaptionStyleLegacy;
}

export interface CompileContext {
  role: 'source' | 'translation';
  hasWordTiming: boolean;
  canvas?: { w: number; h: number };
}

/* ---------- 动效目录（§3.5） ---------- */

export interface MotionPresetInfo {
  key: string;
  trigger: MotionTrigger;
  unit: MotionUnit;
  durationSeconds: number;
  staggerSeconds: number;
}

const P = (key: string, trigger: MotionTrigger, unit: MotionUnit, durationSeconds: number, staggerSeconds = 0): MotionPresetInfo => ({
  key,
  trigger,
  unit,
  durationSeconds,
  staggerSeconds,
});

/** 每一阶段可选的动效与它们的默认触发、单位与时长（原型 `MOTION_PRESETS`）。 */
export const MOTION_PRESETS: Record<MotionStage, readonly MotionPresetInfo[]> = {
  in: [
    P('typewriter', 'enter', 'grapheme', 0.04, 0.04),
    P('fade-up', 'enter', 'cue', 0.3),
    P('rise', 'enter', 'cue', 0.36),
    P('cascade', 'enter', 'word', 0.22, 0.04),
    P('pop', 'enter', 'word', 0.24, 0.05),
    P('blur-in', 'enter', 'cue', 0.38),
    P('slide-mask', 'enter', 'line', 0.36, 0.08),
    P('wave-in', 'enter', 'grapheme', 0.32, 0.025),
    P('drop-in', 'spoken', 'word', 0.4),
    P('float-in-top', 'spoken', 'word', 0.4),
    P('float-in-bottom', 'spoken', 'word', 0.4),
    P('scale-in', 'spoken', 'word', 0.36),
    P('impact', 'spoken', 'word', 0.3),
    P('flip', 'spoken', 'word', 0.4),
    P('stomp', 'spoken', 'word', 0.36),
    P('stack', 'spoken', 'word', 0.3),
  ],
  out: [P('fade-down', 'enter', 'cue', 0.22), P('sink', 'enter', 'cue', 0.3), P('pop-out', 'enter', 'word', 0.2, 0.03), P('blur-out', 'enter', 'cue', 0.3), P('typewriter-erase', 'enter', 'grapheme', 0.03, 0.03)],
  loop: [P('pulse', 'enter', 'cue', 1.2), P('wave', 'enter', 'grapheme', 0.96, 0.03), P('shimmer', 'enter', 'cue', 1.6), P('swing', 'enter', 'word', 1.2, 0.08)],
};
export const MOTION_STAGES: readonly MotionStage[] = ['in', 'out', 'loop'];
export const MOTION_UNITS: readonly MotionUnit[] = ['cue', 'line', 'word', 'grapheme'];

/** 内核 `textMotion` 认的预设（`crates/motion/src/text_motion.rs` 的 ENTRANCES / EXITS / CYCLES）。 */
const TEXT_PRESETS: Record<MotionStage, readonly string[]> = {
  in: ['typewriter', 'fade-up', 'rise', 'cascade', 'pop', 'blur-in', 'slide-mask', 'wave-in'],
  out: ['fade-down', 'sink', 'pop-out', 'blur-out', 'typewriter-erase'],
  loop: ['pulse', 'wave', 'shimmer', 'swing'],
};
/** 内核的缓动名（`crates/motion/src/curve.rs` 的 EASE_NAMES）。 */
const EASE_NAMES = new Set([
  'linear',
  'easeInQuad',
  'easeOutQuad',
  'easeInOutQuad',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
  'easeInQuart',
  'easeOutQuart',
  'easeInOutQuart',
  'easeInExpo',
  'easeOutExpo',
  'easeInOutExpo',
  'easeInSine',
  'easeOutSine',
  'easeInOutSine',
  'easeInBack',
  'easeOutBack',
  'easeInOutBack',
  'easeOutElastic',
]);

export function motionPreset(stage: MotionStage, key: string): MotionPresetInfo | null {
  return MOTION_PRESETS[stage].find((p) => p.key === key) ?? null;
}

/** 一条动效的完整值：缺的键由那条预设的默认补齐。 */
export function motionEffect(stage: MotionStage, key: string, over?: Partial<MotionEffect>): MotionEffect | null {
  const p = motionPreset(stage, key);
  if (!p) return null;
  return { preset: p.key, unit: p.unit, trigger: p.trigger, durationSeconds: p.durationSeconds, staggerSeconds: p.staggerSeconds, intensity: 1, easing: 'easeOutQuad', ...over };
}

export function hasMotion(motion: Motion | null | undefined): motion is Motion {
  return !!motion && MOTION_STAGES.some((stage) => !!motion[stage]);
}

/** 念到时入场、内核由逐词动画目录画的那几条。 */
export function isSpokenPreset(preset: string): boolean {
  return (SPOKEN_PRESETS as readonly string[]).includes(preset);
}

/* ---------- 键表 ---------- */

/**
 * 涂装键：Studio 样式里字体与外观的那一组，包括渲染器认的旧别名（`align`、`bgOn`、`fontStyle`、`outline`），
 * 套卡时先清掉——不清的话旧值会盖过新涂装。
 */
export const PAINT_KEYS: readonly string[] = [
  'fontFamily',
  'fontWeight',
  'bold',
  'italic',
  'fontStyle',
  'underline',
  'fontColor',
  'textAlign',
  'align',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'background',
  'bgOn',
  'backgroundColor',
  'backgroundStyle',
  'backgroundPadding',
  'backgroundPaddingY',
  'borderRadius',
  'outline',
  'textOutline',
  'dropShadow',
  'glow',
];

/** 当前词、动效、逐词底块、强调词外观与来源卡：由正文派生、套卡时整组替换的键（旧键 `anim` / `karaokeColor` 一起清）。 */
export const WORD_KEYS: readonly string[] = ['wordAnimation', 'anim', 'karaokeColor', 'textMotion', 'wordBackground', 'emphasisLook', 'stylePreset'];

/** 落位：编译写、套卡不动。 */
export const LAYOUT_KEYS: readonly string[] = ['fontSize', 'verticalAlign', 'y', 'width'];

const MAPPED_KEYS: readonly string[] = [...PAINT_KEYS, ...WORD_KEYS, ...LAYOUT_KEYS];

/** 预设来源记在根上的键（只做选中态与「还原」，渲染器不读）。 */
export const PRESET_KEY = 'stylePreset';

/* ---------- 小算术 ---------- */

const REFERENCE_SHORT_EDGE = 540;
const REFERENCE_FONT_SIZE = 30;
const r4 = (value: number) => Math.round(value * 1e4) / 1e4;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 颜色拆成 `#RRGGBB` 与 alpha；认不出时用黑。 */
function split(color: unknown): { hex: string; alpha: number } {
  const c = parseColor(color) ?? { r: 0, g: 0, b: 0, a: 1 };
  const byte = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0').toUpperCase();
  return { hex: `#${byte(c.r)}${byte(c.g)}${byte(c.b)}`, alpha: c.a };
}

/** `#RRGGBB` ＋ 不透明度 → `#RRGGBBAA`（总带 alpha，同旧版涂装的写法）。 */
function withAlpha(color: string, alpha: number): string {
  const a = Math.round(clamp(alpha, 0, 1) * 255);
  return `${split(color).hex}${a.toString(16).padStart(2, '0').toUpperCase()}`;
}

/** 内核 `textMotion` 只认 `#RRGGBB` / `#RRGGBBAA`。 */
function hexColor(color: unknown, fallback: string): string {
  const c = parseColor(color);
  if (!c) return fallback;
  const { hex, alpha } = split(color);
  return alpha >= 1 ? hex : withAlpha(hex, alpha);
}

function same(a: unknown, b: unknown, eps = 1e-9): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i], eps));
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!same(a[key], b[key], eps)) return false;
    return true;
  }
  return a === b;
}

/** 两份根对象在这一键上相等（都没有也算）。 */
function sameKey(a: Json, b: Json, key: string, eps?: number): boolean {
  return key in a === key in b && (!(key in a) || same(a[key], b[key], eps));
}

/* ---------- 字体 ＋ 涂装 ---------- */

const CASING_OUT: Record<Casing, string> = { none: 'none', upper: 'uppercase', lower: 'lowercase', title: 'title' };

function compilePaint(t: Typography, s: Surface): Json {
  const out: Json = {
    fontFamily: t.fontFamily,
    fontWeight: t.fontWeight,
    bold: t.fontWeight >= 700,
    italic: t.italic,
    fontStyle: 'normal',
    underline: false,
    fontColor: s.color,
    textAlign: t.align,
    lineHeight: r4(t.lineHeight),
    letterSpacing: r4(t.letterSpacing * REFERENCE_FONT_SIZE),
    textTransform: CASING_OUT[t.casing] ?? 'none',
  };
  const plate = s.plate;
  if (plate) {
    const [px, py] = plate.padding;
    Object.assign(out, {
      background: true,
      backgroundColor: withAlpha(plate.color, plate.opacity),
      backgroundStyle: plate.mode === 'block' ? 'block' : 'wrap',
      backgroundPadding: r4((px * REFERENCE_FONT_SIZE) / 0.8),
      borderRadius: r4((plate.radius * REFERENCE_FONT_SIZE) / 0.55),
    });
    if (Math.abs(py - px / 1.4) > 1e-6) out.backgroundPaddingY = r4((py * REFERENCE_FONT_SIZE) / 0.8);
  } else Object.assign(out, { background: false, backgroundColor: '#00000000', backgroundStyle: 'wrap', backgroundPadding: 0, borderRadius: 0 });
  out.outline = !!s.stroke;
  out.textOutline = s.stroke ? { on: true, color: s.stroke.color, width: r4(s.stroke.width * 200) } : { on: false, color: '#000000', width: 0 };
  if (s.shadow) {
    const [x, y] = s.shadow.offset;
    const rotation = (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360;
    out.dropShadow = {
      on: true,
      distance: r4(Math.hypot(x, y)),
      rotation: r4(rotation),
      blur: r4(s.shadow.blur),
      color: s.shadow.color,
      opacity: r4(s.shadow.opacity ?? 1),
    };
  } else out.dropShadow = { on: false };
  out.glow = s.glow ? { on: true, color: s.glow.color, intensity: r4(s.glow.intensity), range: r4(s.glow.range) } : { on: false };
  return out;
}

/** 渲染器的口径（`resolveLineStyle`）读涂装：开着的才进正文。 */
function parsePaint(root: Json): { typography: Typography; surface: Surface } {
  let weight = Math.round(clamp(weightOf(root.fontWeight), 100, 900));
  if (root.bold === true) weight = Math.max(weight, 700);
  const transform = root.textTransform;
  const align = root.textAlign ?? root.align;
  const typography: Typography = {
    fontFamily: typeof root.fontFamily === 'string' ? root.fontFamily : 'system',
    fontWeight: weight,
    italic: root.italic === true || root.fontStyle === 'italic',
    size: num(root.fontSize, REFERENCE_FONT_SIZE) / REFERENCE_SHORT_EDGE,
    lineHeight: num(root.lineHeight, 1.2),
    letterSpacing: num(root.letterSpacing, 0) / REFERENCE_FONT_SIZE,
    casing: transform === 'uppercase' ? 'upper' : transform === 'lowercase' ? 'lower' : transform === 'title' || transform === 'capitalize' ? 'title' : 'none',
    align: align === 'left' || align === 'right' ? align : 'center',
  };
  const surface: Surface = { color: typeof root.fontColor === 'string' ? root.fontColor : '#FFFFFF' };

  const outline = asObject(root.textOutline);
  const legacyOutline = root.outline === true;
  const outlineColor = typeof outline.color === 'string' ? outline.color : '#000000E0';
  const outlineWidth = num(outline.width, legacyOutline ? 14 : 0);
  const outlineOn =
    typeof outline.on === 'boolean' ? outline.on : typeof root.outline === 'boolean' ? root.outline : outlineWidth > 0 && (parseColor(outlineColor)?.a ?? 0) > 3 / 255;
  if (outlineOn && outlineWidth > 0) surface.stroke = { color: outlineColor, width: outlineWidth / 200 };

  const glow = asObject(root.glow);
  const glowOn = typeof glow.on === 'boolean' ? glow.on : num(glow.intensity, 0) > 0;
  if (glowOn) surface.glow = { color: typeof glow.color === 'string' ? glow.color : '#FFFFFF', intensity: num(glow.intensity, 50), range: num(glow.range, 40) };
  const shadow = asObject(root.dropShadow);
  const shadowOn = typeof shadow.on === 'boolean' ? shadow.on : num(shadow.blur, 0) > 0 || num(shadow.distance, 0) > 0;
  if (shadowOn) {
    const distance = Math.max(0, num(shadow.distance, 0.04));
    const angle = (num(shadow.rotation, 90) * Math.PI) / 180;
    surface.shadow = {
      color: typeof shadow.color === 'string' ? shadow.color : '#000000',
      offset: [Math.cos(angle) * distance, Math.sin(angle) * distance],
      blur: Math.max(0, num(shadow.blur, legacyOutline ? 0.12 : 0.08)),
      opacity: clamp(num(shadow.opacity, legacyOutline ? 0.48 : 0.6), 0, 1),
    };
  }

  const bg = parseColor(root.backgroundColor);
  const plateOn = typeof root.background === 'boolean' ? root.background : typeof root.bgOn === 'boolean' ? root.bgOn : (bg?.a ?? 0) > 3 / 255;
  if (plateOn) {
    const padH = (Math.max(0, num(root.backgroundPadding, 10)) * 0.8) / REFERENCE_FONT_SIZE;
    const padY = root.backgroundPaddingY;
    const padV = typeof padY === 'number' && Number.isFinite(padY) && padY >= 0 ? (padY * 0.8) / REFERENCE_FONT_SIZE : padH / 1.4;
    const radius = typeof root.borderRadius === 'number' && Number.isFinite(root.borderRadius) ? (Math.max(0, root.borderRadius) * 0.55) / REFERENCE_FONT_SIZE : padH;
    const { hex, alpha } = split(root.backgroundColor ?? '#000000CC');
    surface.plate = { mode: root.backgroundStyle === 'block' ? 'block' : 'line', color: hex, opacity: bg ? alpha : 0.8, padding: [padH, padV], radius };
  }
  return { typography, surface };
}

/* ---------- 落位 ---------- */

function compileLayout(layout: Layout, typography: Typography): Json {
  return {
    fontSize: r4(typography.size * REFERENCE_SHORT_EDGE),
    verticalAlign: layout.anchor,
    y: r4(layout.y * 100),
    width: r4(layout.width * 100),
  };
}

function parseLayout(root: Json): Layout {
  const v = root.verticalAlign;
  return { mode: 'line', anchor: v === 'top' || v === 'bottom' ? v : 'center', y: num(root.y, 86) / 100, width: num(root.width, 80) / 100, maxLines: 2 };
}

/* ---------- 当前词 ＋ 动效 ---------- */

/** 译文 / 没有词级时间的轨：当前词恒 none；念到时触发的入场改成出现时（内核目录那几格没有「念到」可言，丢掉）。 */
export function forRole(body: Pick<CaptionStyleBody, 'activeWord' | 'motion'>, ctx: CompileContext): { activeWord: ActiveWord; motion: Motion | null } {
  const timed = ctx.role === 'source' && ctx.hasWordTiming;
  if (timed) return { activeWord: normalizeActive(body.activeWord), motion: hasMotion(body.motion) ? body.motion : null };
  let motion: Motion | null = null;
  if (hasMotion(body.motion)) {
    const out: Motion = {};
    for (const stage of MOTION_STAGES) {
      const e = body.motion[stage];
      if (e && !isSpokenPreset(e.preset)) out[stage] = { ...e, trigger: 'enter' };
    }
    motion = hasMotion(out) ? out : null;
  }
  return { activeWord: normalizeActive({ mode: 'none' }), motion };
}

function textEffect(e: MotionEffect): Json {
  const out: Json = {
    preset: e.preset,
    unit: MOTION_UNITS.includes(e.unit) ? e.unit : 'cue',
    durationSeconds: clamp(num(e.durationSeconds, 0.3), 0.001, 60),
    staggerSeconds: clamp(num(e.staggerSeconds, 0), 0, 10),
    intensity: clamp(num(e.intensity, 1), 0, 2),
    easing: e.easing === 'overshoot' ? 'easeOutBack' : EASE_NAMES.has(e.easing) ? e.easing : 'easeOutQuad',
  };
  if (e.order && e.order !== 'forward') out.order = e.order;
  if (typeof e.seed === 'number' && e.seed > 0) out.seed = Math.round(clamp(e.seed, 0, 4294967295));
  return out;
}

/** 当前词色落不落到 `textMotion.emphasis`：走 textMotion 时内核不读 `wordAnimation`，当前词只能靠它上色、放大。 */
const EMPHASIS_MODES = new Set(['color', 'box', 'lift', 'underline', 'scale']);

function compileWord(body: CaptionStyleBody, ctx: CompileContext): Json {
  const out: Json = {};
  if (body.emphasis) {
    const e = body.emphasis;
    out.emphasisLook = {
      ...(e.color ? { color: e.color } : {}),
      ...(e.fontFamily ? { fontFamily: e.fontFamily } : {}),
      ...(e.bold !== undefined ? { bold: e.bold } : {}),
      ...(e.italic !== undefined ? { italic: e.italic } : {}),
      // 内核夹在 0.8–1.6（主角词内核自己再 ×1.15，这里不乘）。
      scale: clamp(num(e.scale, 1), 0.8, 1.6),
    };
  }
  if (body.preset) out[PRESET_KEY] = { id: body.preset.id, revision: body.preset.revision };
  if (body.layout.mode === 'sequence' && ctx.role === 'source') {
    out.wordAnimation = sequenceWordAnimation(normalizeSequence(body.layout.sequence));
    return out;
  }
  const { activeWord: aw, motion } = forRole(body, ctx);
  const spokenIn = motion?.in && motion.in.trigger === 'spoken' && isSpokenPreset(motion.in.preset) ? motion.in : null;
  const entrance: SpokenEntrance | null = spokenIn ? { preset: spokenIn.preset, intensity: spokenIn.intensity, tilt: spokenIn.tilt } : null;
  out.wordAnimation = wordAnimationOf(aw, entrance);

  const tm: Json = { version: 1 };
  for (const stage of MOTION_STAGES) {
    const e = motion?.[stage];
    if (!e || e === spokenIn || !TEXT_PRESETS[stage].includes(e.preset)) continue;
    tm[stage] = textEffect(e);
  }
  const fontColor = body.surface.color;
  const scaled = typeof aw.scale === 'number' && Math.abs(aw.scale - 1) > 1e-6;
  const wordBox = body.surface.wordBox;
  const needs = Object.keys(tm).length > 1 || aw.mode === 'sweep' || aw.mode === 'scale' || scaled || !!wordBox;
  if (!needs) return out;
  if (aw.mode === 'sweep') {
    tm.karaoke = {
      color: hexColor(aw.color, '#FFD43B'),
      ...(aw.sweep?.guide ? { guide: true } : {}),
      ...(aw.sweep?.nextLine ? { nextLine: true } : {}),
      ...(aw.sweep?.unit === 'word' ? { unit: 'word' } : {}),
    };
  } else if (EMPHASIS_MODES.has(aw.mode)) {
    tm.emphasis = {
      color: hexColor(aw.color ?? fontColor, '#FFFFFF'),
      scale: clamp(num(aw.scale, 1), 0.1, 3),
      durationSeconds: clamp(num(aw.durationSeconds, 0.16), 0.001, 10),
    };
  }
  if (Object.keys(tm).length > 1) out.textMotion = tm;
  const box = aw.mode === 'box' ? aw.box : undefined;
  if (wordBox || box) {
    const shape = wordBox ?? box!;
    out.wordBackground = {
      color: wordBox ? hexColor(wordBox.color, '#00000000') : '#00000000',
      activeColor: box ? hexColor(box.color, '#FFD43B') : hexColor(wordBox!.color, '#00000000'),
      paddingXEm: shape.padding[0],
      paddingYEm: shape.padding[1],
      radiusEm: shape.radius,
    };
  }
  return out;
}

function parseEffect(value: unknown): MotionEffect | null {
  const e = asObject(value);
  if (typeof e.preset !== 'string') return null;
  const out: MotionEffect = {
    preset: e.preset,
    unit: MOTION_UNITS.includes(e.unit as MotionUnit) ? (e.unit as MotionUnit) : 'cue',
    trigger: 'enter',
    durationSeconds: num(e.durationSeconds, 0.3),
    staggerSeconds: num(e.staggerSeconds, 0),
    intensity: num(e.intensity, 1),
    easing: typeof e.easing === 'string' ? e.easing : 'easeOutQuad',
  };
  if (e.order === 'backward' || e.order === 'center' || e.order === 'random') out.order = e.order;
  if (typeof e.seed === 'number' && e.seed > 0) out.seed = e.seed;
  return out;
}

function parseWord(root: Json, surface: Surface): { activeWord: ActiveWord; motion?: Motion; layout?: Partial<Layout>; emphasis?: EmphasisLook; preset?: { id: string; revision: number } } {
  const out: ReturnType<typeof parseWord> = { activeWord: normalizeActive({ mode: 'none' }) };
  const look = asObject(root.emphasisLook);
  if (isObject(root.emphasisLook)) {
    out.emphasis = { scale: num(look.scale, 1) };
    if (typeof look.color === 'string') out.emphasis.color = look.color;
    if (typeof look.fontFamily === 'string') out.emphasis.fontFamily = look.fontFamily;
    if (typeof look.bold === 'boolean') out.emphasis.bold = look.bold;
    if (typeof look.italic === 'boolean') out.emphasis.italic = look.italic;
  }
  const preset = asObject(root[PRESET_KEY]);
  if (typeof preset.id === 'string') out.preset = { id: preset.id, revision: num(preset.revision, 1) };

  const designed = designedCaptionOf(root);
  if (designed && asObject(designed.style).id === SEQUENCE_STYLE_ID) {
    const sequence = parseSequence(designed);
    out.layout = { mode: 'sequence', sequence };
    out.activeWord = normalizeActive({ mode: 'color', color: sequence.palette.accent });
    return out;
  }

  const parsed = parseWordAnimation(root);
  const aw = parsed.activeWord;
  const motion: Motion = {};
  if (parsed.entrance) {
    const e = motionEffect('in', parsed.entrance.preset, { trigger: 'spoken', unit: 'word' });
    if (e) {
      if (parsed.entrance.intensity !== undefined) e.intensity = parsed.entrance.intensity;
      if (parsed.entrance.tilt) e.tilt = true;
      motion.in = e;
    }
  }
  const tm = isObject(root.textMotion) ? root.textMotion : null;
  if (tm) {
    for (const stage of MOTION_STAGES) {
      const e = parseEffect(tm[stage]);
      if (e) motion[stage] = e;
    }
    const karaoke = asObject(tm.karaoke);
    const emphasis = asObject(tm.emphasis);
    if (typeof karaoke.color === 'string') {
      aw.mode = 'sweep';
      aw.color = karaoke.color;
      aw.sweep = { unit: karaoke.unit === 'word' ? 'word' : 'grapheme', guide: karaoke.guide === true, nextLine: karaoke.nextLine === true };
      delete aw.scale;
    } else if (typeof emphasis.color === 'string') {
      if (aw.mode === 'none') aw.mode = 'scale';
      aw.color = emphasis.color;
      aw.scale = num(emphasis.scale, 1);
      aw.durationSeconds = num(emphasis.durationSeconds, 0.16);
    }
  }
  const wb = asObject(root.wordBackground);
  if (typeof wb.color === 'string' && typeof wb.activeColor === 'string') {
    const padding: [number, number] = [num(wb.paddingXEm, 0.2), num(wb.paddingYEm, 0.08)];
    const radius = num(wb.radiusEm, 0.12);
    if ((parseColor(wb.color)?.a ?? 0) > 0) surface.wordBox = { color: wb.color, padding, radius };
    const distinct = !same(split(wb.activeColor), split(wb.color), 1e-3);
    if (aw.mode === 'box' || (distinct && (aw.mode === 'color' || aw.mode === 'none' || aw.mode === 'scale'))) {
      aw.mode = 'box';
      aw.box = { color: wb.activeColor, radius, padding };
    }
  }
  out.activeWord = normalizeActive(aw);
  if (hasMotion(motion)) out.motion = motion;
  return out;
}

/* ---------- 编译与解析 ---------- */

function compileFresh(body: CaptionStyleBody, ctx: CompileContext): Json {
  return { ...compileLayout(body.layout, body.typography), ...compilePaint(body.typography, body.surface), ...compileWord(body, ctx) };
}

/**
 * 新正文 → Studio 根样式（§8）。确定、无副作用：同一份正文在画廊、画布与导出得到同一份样式。
 * `ctx.role` 是这份样式落在哪一种行上（译文与没有词级时间的轨，当前词恒 none、不扫色）。
 */
export function compileCaptionStyle(body: CaptionStyleBody, ctx: CompileContext): Json {
  const fresh = compileFresh(body, ctx);
  const legacy = body.legacy;
  const out: Json = { ...legacy?.keys };
  for (const key of MAPPED_KEYS) {
    let has = key in fresh;
    let value = fresh[key];
    const kept = legacy?.overrides[key];
    if (kept && 'derived' in kept === has && (!has || same(kept.derived, value))) {
      has = 'value' in kept;
      value = kept.value;
    }
    if (has) out[key] = value;
  }
  return out;
}

/** Studio 根样式 → 新正文（尽力）：解析不出的键进 `legacy`，编译回去逐键相等。 */
export function parseStudioStyle(root: Json): CaptionStyleBody {
  const { typography, surface } = parsePaint(root);
  const word = parseWord(root, surface);
  const layout: Layout = { ...parseLayout(root), ...word.layout };
  const body: CaptionStyleBody = { schema: CAPTION_STYLE_SCHEMA, typography, surface, layout, activeWord: word.activeWord };
  if (word.motion) body.motion = word.motion;
  if (word.emphasis) body.emphasis = word.emphasis;
  if (word.preset) body.preset = word.preset;
  const fresh = compileFresh(body, { role: 'source', hasWordTiming: true });
  const keys: Json = {};
  for (const [key, value] of Object.entries(root)) if (!MAPPED_KEYS.includes(key)) keys[key] = value;
  const overrides: CaptionStyleLegacy['overrides'] = {};
  for (const key of MAPPED_KEYS) {
    if (sameKey(root, fresh, key)) continue;
    const entry: { value?: unknown; derived?: unknown } = {};
    if (key in root) entry.value = root[key];
    if (key in fresh) entry.derived = fresh[key];
    overrides[key] = entry;
  }
  body.legacy = { keys, overrides };
  return body;
}

/** 正文里只留某几类映射键的旧值（预设：只留涂装的，当前词与落位由预设自己给）。 */
export function keepOverrides(body: CaptionStyleBody, keys: readonly string[]): CaptionStyleBody {
  if (!body.legacy) return body;
  const overrides: CaptionStyleLegacy['overrides'] = {};
  for (const [key, value] of Object.entries(body.legacy.overrides)) if (keys.includes(key)) overrides[key] = value;
  return { ...body, legacy: { keys: body.legacy.keys, overrides } };
}

/** 一份根样式的 Studio 正文（同 `patchCaptionStyle` 的外壳）。 */
export function studioDocument(root: Json): Json {
  return { schema: STUDIO_STYLE, style: root };
}

/** 两份根样式在这些键上相等（数值容差 1e-6）。 */
export function sameKeys(a: Json, b: Json, keys: readonly string[]): boolean {
  return keys.every((key) => sameKey(a, b, key, 1e-6));
}

/** 编辑一个维度：解析 → 改 → 编译回根样式（`role` 默认源语言）。 */
export function editCaptionStyle(root: Json, edit: (body: CaptionStyleBody) => CaptionStyleBody, ctx: CompileContext = { role: 'source', hasWordTiming: true }): Json {
  return compileCaptionStyle(edit(parseStudioStyle(root)), ctx);
}
