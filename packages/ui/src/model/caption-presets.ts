import { defineMessages, formatRef, LOCALES, type CaptionItem, type DocumentRecord, type EditOperation, type Id, type Sequence } from '@baocut/protocol';
import { STUDIO_STYLE, asObject, isObject, mergedLineStyle, type Json, type LineKind } from '../render/text-style.ts';
import type { CaptionChip } from './caption-tracks.ts';
import { LINE_STYLE_KEY, lineSize } from './caption-lines.ts';
import { zhHans } from './caption-presets.zh-Hans.ts';
import { zhHant } from './caption-presets.zh-Hant.ts';
import { ja } from './caption-presets.ja.ts';
import { ko } from './caption-presets.ko.ts';
import { es } from './caption-presets.es.ts';
import { fr } from './caption-presets.fr.ts';
import { de } from './caption-presets.de.ts';
import { nl } from './caption-presets.nl.ts';
import { ptBR } from './caption-presets.pt-BR.ts';
import { it } from './caption-presets.it.ts';
import { ru } from './caption-presets.ru.ts';
import { pl } from './caption-presets.pl.ts';
import { tr } from './caption-presets.tr.ts';
import { vi } from './caption-presets.vi.ts';

/** 字幕样式画廊的文案（英文是键与类型的来源，译文在 `caption-presets.zh-Hans.ts`）。英文名的卡（Shorts、Ali……）不进目录。 */
const en = {
  groupDefault: 'Default',
  groupSocial: 'Social',
  groupBusiness: 'Business',
  classic: 'Classic',
  studio: {
    'studio-focus': 'Spoken Emphasis',
    'studio-word-tiles': 'Word Tiles',
    'studio-word-drop': 'Word Drop',
    'studio-paper-typewriter': 'Typewriter',
    'studio-line-swipe': 'Line Swipe',
    'studio-soft-focus': 'Soft Focus',
    'studio-rise-settle': 'Rise & Settle',
    'studio-kinetic-wave': 'Kinetic Wave',
    'studio-ktv': 'Karaoke',
  } as Record<string, string>,
  styleDocument: 'Subtitle style',
};
export type CaptionPresetsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 流程新建的缺省字幕样式文档的名字（jobs 的 `jobsCaptionLayer.styleName`）：界面新建的与它同名。 */
const STYLE_NAME_REF = { key: 'jobsCaptionLayer.styleName' };

/** 新建的字幕样式文档叫什么（当前语言）。 */
export function defaultStyleName(): string {
  return formatRef(STYLE_NAME_REF, M.styleDocument);
}

/** 这个名字是不是缺省字幕样式的名字：哪种语言下建的都认（文档名按建它时的语言写进视频）。 */
export function isDefaultStyleName(name: string): boolean {
  return name === M.styleDocument || LOCALES.some((locale) => formatRef(STYLE_NAME_REF, '', locale) === name);
}

/**
 * 字幕样式画廊的预设（原型 panel-substyle.jsx 的 `SubGallery`，目录在 data.js `subtitle.catalog` / `cats`）。
 *
 * 一张卡是一份**涂装**：字体、字重、颜色、对齐、行高、字距、大小写、底板、描边、阴影 / 发光——全部是 Studio 字幕样式
 * （`baocut.legacy-studio-style/0.1`）里渲染内核（预览与导出同一份，`crates/subtitle-render`）读的字段。
 * 套一张只换涂装：位置（x / y / width / verticalAlign / scale）、显示时机、双语次序与间距、字号与双语比例都不动
 * （原型「套一张只换涂装，不会多一条、也不会少一条」）。
 *
 * 三家来源与换算：
 * - `BC_DS`（model-defaultsub.js）的「经典」「Shorts」：照旧版内核 `style_library::classic_look` / `shorts_look`
 *   逐字段写（那两份与新建项目的种子对齐），去掉字号。
 * - `BC_VS`（model-subpresets.js）的社交涂装：原型单位的 look 存在这里，换算照旧版内核的 look 换算（`lookStyle`）。
 * - `BC_SD`（model-subtitle-designs.js）的 Studio 设计：原生就是样式文档字段（`nativeStyle`），只留渲染器读的那几项。
 *
 * 画廊分组与次序照 data.js：目录 = `BC_DS.cards` → `BC_VS.cards` → 倒鸭子 → `BC_SD.cards`，按家族去重（`screenCatalog`，
 * `BC_SD.representative` 把 31 份涂装收成 7 个代表），再按 cats（默认 / Shorts / 动态排版 / 社交 / 商务 / 复古）分区、
 * 空区不出。
 *
 * 样式文档表达不了、所以没有收进来的（要改渲染器或样式 schema）：
 * - 逐词动画与当前词颜色（卡上的 `anim` / `activeColor`：经典的 colourHighlight `#18E1D6`、Shorts 的 bounce `#FFE14D`）；
 * - `BC_SD` 的 `textMotion`（强调词放大、逐词 / 逐字 / 逐行入场、柔焦、升起落定、字符波浪、KTV 走字）与 `wordBackground`（逐词底块）——
 *   这九张卡只套得上它们的静态涂装，卡上用 `motion` 标出来；
 * - 倒鸭子（`kinetic`：跨句动态排版 ＋ 镜头），整区「动态排版」不出；
 * - Shorts 的落位（约画宽 5.5% 的字号、块下沿贴 72% 安全框）——那是位置不是涂装，这里不写；
 * - 强调词（`highlight`）与单句覆盖（cue 级样式）。
 */

/** 原型单位的一份 look（model-subpresets.js 表头那张换算表）：`lh` 百分比、`spacing` 1/100 em、`corners` / `pad` 占字号百分比，
 *  `outlineW` 是 `fz × outlineW / 160` 的那个数，`shDist` / `shBlur` 占字号百分比，`shColor` 带 alpha。 */
export interface DesignLook {
  font: string;
  weight: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lh: number;
  spacing: number;
  upper: '' | 'upper' | 'lower' | 'title';
  bg: string;
  opacity: number;
  corners: number;
  pad: number;
  plate: 'line' | 'block';
  outline: boolean;
  outlineColor: string;
  outlineW: number;
  shadow: boolean;
  shDist: number;
  shAngle: number;
  shBlur: number;
  shColor: string;
}

export type PresetGroupKey = 'default' | 'shorts' | 'social' | 'business';

export interface CaptionPreset {
  /** 家族键（原型 `family(id)`：`v-ali` / `vb-ali` / `vt-ali` 都是 `ali`）。 */
  id: string;
  name: string;
  group: PresetGroupKey;
  /** 套上去写进样式文档的涂装（完整的一份：每个涂装键都给值）。 */
  style: Json;
  /** 原型这张卡还带着逐词 / 逐字动效，这里只套得上静态涂装。 */
  motion?: boolean;
}

/** 画廊的分区（data.js `subtitle.cats`）。「动态排版」只有倒鸭子、「复古」去重后没有卡，两区不出。 */
export const PRESET_GROUPS: readonly { key: PresetGroupKey; label: string }[] = [
  {
    key: 'default',
    get label() {
      return M.groupDefault;
    },
  },
  { key: 'shorts', label: 'Shorts' },
  {
    key: 'social',
    get label() {
      return M.groupSocial;
    },
  },
  {
    key: 'business',
    get label() {
      return M.groupBusiness;
    },
  },
];

/**
 * 涂装键：一张卡写的、套卡时先从样式里清掉的。包括渲染器认的旧别名（`align`、`bgOn`、`fontStyle`、`outline`），
 * 不清掉的话旧值会盖过新涂装（比如 `fontStyle: 'italic'` 让新涂装也斜）。
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

/** 涂装之外、一张卡也要定下来的几项缺省（旧版 `base_style`）。 */
const BASE: Json = {
  fontStyle: 'normal',
  underline: false,
  textAlign: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,
  textTransform: 'none',
  background: false,
  backgroundColor: '#000000CC',
  backgroundStyle: 'wrap',
  backgroundPadding: 10,
  borderRadius: 15,
};

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** `#RRGGBB(AA)` 去掉 alpha。 */
function opaque(color: string): string {
  const value = color.trim();
  return value.startsWith('#') && value.length >= 7 ? value.slice(0, 7) : value;
}

/** `#RRGGBBAA` 的 alpha（0–1）；别的写法当不透明。 */
function alphaOf(color: string): number {
  return color.startsWith('#') && color.length === 9 ? round(parseInt(color.slice(7, 9), 16) / 255) : 1;
}

/** 不透明色 ＋ 百分比不透明度 → `#RRGGBBAA`。 */
function withOpacity(color: string, percent: number): string {
  const alpha = Math.round((Math.min(100, Math.max(0, percent)) * 255) / 100);
  return `${opaque(color)}${alpha.toString(16).padStart(2, '0').toUpperCase()}`;
}

/** 字体名：两款商用字体换成原型的替身；字重后缀（`Poppins SemiBold`）去掉，字重由 `fontWeight` 给。 */
export function fontFamilyOf(font: string): string {
  if (font === 'Komika Axis') return 'Bangers';
  if (font === 'The Bold Font') return 'Poppins';
  const space = font.indexOf(' ');
  if (space < 0) return font;
  const suffix = font.slice(space + 1);
  return ['Medium', 'SemiBold', 'Semibold', 'Extrabold', 'Black'].includes(suffix) ? font.slice(0, space) : font;
}

/** 一份涂装补齐成完整的：阴影与发光两个槽都给值（只开一个），描边的旧布尔与 `textOutline.on` 一致。 */
function complete(style: Json): Json {
  const outline = asObject(style.textOutline);
  return {
    ...BASE,
    ...style,
    outline: outline.on === true,
    dropShadow: isObject(style.dropShadow) ? style.dropShadow : { on: false },
    glow: isObject(style.glow) ? style.glow : { on: false },
  };
}

/**
 * 原型 look → 样式文档的涂装（照旧版内核的换算）：字距 ×0.3（1/100 em → 30 号字的逻辑像素），描边 ×1.25（居中笔宽），
 * 圆角 30×corners/55，留白 30×1.4×pad/80（纵向是横向 ÷1.4），阴影距离 / 模糊 ÷100。有阴影而距离为 0 的是发光
 * （强度取阴影色的 alpha，范围 = 模糊 ÷0.9）。
 */
export function lookStyle(look: DesignLook): Json {
  const shadow = look.shadow && look.shDist === 0
    ? { glow: { on: true, color: opaque(look.shColor), intensity: round(alphaOf(look.shColor) * 100), range: round(look.shBlur / 0.9) } }
    : {
        dropShadow: {
          on: look.shadow,
          distance: round(look.shDist / 100),
          rotation: look.shAngle,
          blur: round(look.shBlur / 100),
          color: opaque(look.shColor),
          opacity: alphaOf(look.shColor),
        },
      };
  return complete({
    fontFamily: fontFamilyOf(look.font),
    fontWeight: Math.min(900, Math.max(100, Math.round(look.weight))),
    bold: look.bold,
    italic: look.italic,
    fontColor: look.color,
    textAlign: look.align,
    lineHeight: round(look.lh / 100),
    letterSpacing: round(look.spacing * 0.3),
    textTransform: look.upper === 'upper' ? 'uppercase' : look.upper === 'lower' ? 'lowercase' : look.upper === 'title' ? 'title' : 'none',
    background: look.opacity > 0,
    backgroundColor: withOpacity(look.bg, look.opacity),
    backgroundStyle: look.plate === 'block' ? 'block' : 'wrap',
    backgroundPadding: round((30 * 1.4 * look.pad) / 80),
    borderRadius: round((30 * look.corners) / 55),
    textOutline: { on: look.outline, color: look.outlineColor, width: round(look.outlineW * 1.25) },
    ...shadow,
  });
}

/** 经典：新建项目的种子涂装（旧版 `classic_look`，去掉字号 34——字号是落位）。默认预设（`DEFAULT_CAPTION_STYLE`）用它。 */
export const CLASSIC: Json = complete({
  fontFamily: 'system',
  fontWeight: 700,
  bold: true,
  italic: false,
  fontColor: '#FFFFFF',
  backgroundColor: '#000000B3',
  textOutline: { on: true, color: '#000000', width: 14 },
  dropShadow: { on: true, blur: 0.12, distance: 0.08, rotation: 45, color: '#000000', opacity: 0.9 },
});

/** Shorts：经典之上改字重、行高、描边与投影（旧版 `shorts_look`）。 */
const SHORTS: Json = {
  ...CLASSIC,
  fontWeight: 800,
  lineHeight: 1.1,
  textOutline: { on: true, color: '#000000', width: 17.5 },
  dropShadow: { on: true, blur: 0.1, distance: 0.06, rotation: 90, color: '#000000', opacity: 0.9 },
};

/** 画廊里露面的 7 份 look 涂装（`BC_VS.LOOKS`，与旧版内核的涂装目录逐字段相同）。 */
const GALLERY_LOOKS: Record<string, DesignLook> = {
  ali: { font: 'Poppins SemiBold', weight: 600, bold: false, italic: false, color: '#000000', align: 'center', lh: 200, spacing: 1, upper: '', bg: '#FAFBFF', opacity: 100, corners: 30, pad: 20, plate: 'line', outline: false, outlineColor: '#000000', outlineW: 0, shadow: false, shDist: 12, shAngle: 90, shBlur: 24, shColor: '#000000cc' },
  karl: { font: 'Poppins SemiBold', weight: 600, bold: false, italic: false, color: '#ffffff', align: 'center', lh: 115, spacing: 0, upper: 'upper', bg: '#000000', opacity: 0, corners: 0, pad: 20, plate: 'line', outline: true, outlineColor: '#000000', outlineW: 11, shadow: true, shDist: 1, shAngle: 180, shBlur: 25, shColor: '#000000ff' },
  lime: { font: 'The Bold Font', weight: 900, bold: false, italic: false, color: '#232323', align: 'center', lh: 105, spacing: -2, upper: 'upper', bg: '#B6FF60', opacity: 100, corners: 30, pad: 20, plate: 'line', outline: false, outlineColor: '#000000', outlineW: 0, shadow: false, shDist: 12, shAngle: 90, shBlur: 24, shColor: '#000000cc' },
  phantom: { font: 'Poppins Extrabold', weight: 800, bold: false, italic: false, color: '#ffffff', align: 'center', lh: 125, spacing: -2, upper: '', bg: '#000000', opacity: 0, corners: 0, pad: 20, plate: 'line', outline: true, outlineColor: '#000000', outlineW: 11, shadow: true, shDist: 1, shAngle: 180, shBlur: 15, shColor: '#0000004D' },
  bulb: { font: 'Poppins Extrabold', weight: 800, bold: false, italic: false, color: '#ffffff', align: 'center', lh: 90, spacing: -6, upper: 'upper', bg: '#000000', opacity: 0, corners: 0, pad: 20, plate: 'line', outline: true, outlineColor: '#000000', outlineW: 2, shadow: true, shDist: 1, shAngle: 180, shBlur: 100, shColor: '#ffffff' },
  vegas: { font: 'Poppins Extrabold', weight: 800, bold: false, italic: false, color: '#ffffff', align: 'center', lh: 125, spacing: -2, upper: 'upper', bg: '#000000', opacity: 0, corners: 0, pad: 20, plate: 'line', outline: true, outlineColor: '#ff98e9', outlineW: 3, shadow: true, shDist: 1, shAngle: 180, shBlur: 99, shColor: '#FF25CE' },
  simple: { font: 'Poppins', weight: 400, bold: true, italic: false, color: '#ffffff', align: 'center', lh: 120, spacing: 2, upper: '', bg: '#000000', opacity: 0, corners: 0, pad: 20, plate: 'line', outline: true, outlineColor: '#000000', outlineW: 11, shadow: true, shDist: 5, shAngle: 90, shBlur: 10, shColor: '#000000ff' },
};

/**
 * `BC_SD` 的九份 Studio 设计（`nativeStyle`）。去掉了：`fontSize` / `fontSizeBasis`（字号是落位）、重复的 `align`、
 * 渲染器不读的 `textMotion` 与 `wordBackground`（各卡的动效写在行尾注释里）；`Poppins Black` 按 `fontFamilyOf` 收成 `Poppins` ＋ 900。
 */
const STUDIO_DESIGNS: { id: string; style: Json }[] = [
  // textMotion: emphasis（强调词放大 1.18 ×、#FC75E9）
  { id: 'studio-focus', style: { fontFamily: 'Anton', fontWeight: 400, bold: false, italic: false, fontColor: '#FFFFFF', lineHeight: 0.95, letterSpacing: 0.66, textTransform: 'uppercase', textAlign: 'center', background: false, backgroundColor: '#00000000', backgroundStyle: 'wrap', backgroundPadding: 0, backgroundPaddingY: 0, borderRadius: 0, textOutline: { on: true, color: '#000000', width: 32.8767 }, dropShadow: { on: true, color: '#000000', blur: 0, distance: 0.1912, rotation: 40.156, opacity: 0.88 } } },
  // textMotion: emphasis；wordBackground：逐词深色底块、当前词 #FFD84D
  { id: 'studio-word-tiles', style: { fontFamily: 'Inter', fontWeight: 500, bold: false, italic: false, fontColor: '#FFFDF7', lineHeight: 1.12, letterSpacing: -0.36, textTransform: 'none', textAlign: 'center', background: false, backgroundColor: '#00000000', backgroundStyle: 'wrap', backgroundPadding: 0, backgroundPaddingY: 0, borderRadius: 0, textOutline: { on: false, color: '#000000', width: 0 }, dropShadow: { on: false, color: '#000000', blur: 0, distance: 0, rotation: 0, opacity: 1 } } },
  // textMotion.in: cascade（逐词）
  { id: 'studio-word-drop', style: { fontFamily: 'Poppins', fontWeight: 900, bold: false, italic: false, fontColor: '#232323', lineHeight: 1.04, letterSpacing: -0.54, textTransform: 'none', textAlign: 'center', background: true, backgroundColor: '#C7FF5A', backgroundStyle: 'wrap', backgroundPadding: 7.7586, backgroundPaddingY: 7.7586, borderRadius: 13.1661, textOutline: { on: false, color: '#000000', width: 0 }, dropShadow: { on: false, color: '#000000', blur: 0, distance: 0, rotation: 0, opacity: 1 } } },
  // textMotion.in: typewriter（逐字）
  { id: 'studio-paper-typewriter', style: { fontFamily: 'Roboto Mono', fontWeight: 500, bold: false, italic: false, fontColor: '#241F1A', lineHeight: 1.16, letterSpacing: 0, textTransform: 'none', textAlign: 'left', background: true, backgroundColor: '#F4EBDD', backgroundStyle: 'wrap', backgroundPadding: 10.7143, backgroundPaddingY: 10.7143, borderRadius: 10.3896, textOutline: { on: false, color: '#000000', width: 0 }, dropShadow: { on: false, color: '#000000', blur: 0, distance: 0, rotation: 0, opacity: 1 } } },
  // textMotion.in: slide-mask（逐行）
  { id: 'studio-line-swipe', style: { fontFamily: 'Poppins', fontWeight: 900, bold: false, italic: false, fontColor: '#FFF8F2', lineHeight: 1, letterSpacing: -0.54, textTransform: 'none', textAlign: 'center', background: false, backgroundColor: '#00000000', backgroundStyle: 'wrap', backgroundPadding: 0, backgroundPaddingY: 0, borderRadius: 0, textOutline: { on: true, color: '#000000', width: 13.7931 }, dropShadow: { on: true, color: '#FF6B5B', blur: 0, distance: 0.22, rotation: 33.2749, opacity: 1 } } },
  // textMotion.in: blur-in（整句）
  { id: 'studio-soft-focus', style: { fontFamily: 'Inter', fontWeight: 500, bold: false, italic: false, fontColor: '#FFFDF7', lineHeight: 1.1, letterSpacing: 0.15, textTransform: 'none', textAlign: 'center', background: false, backgroundColor: '#00000000', backgroundStyle: 'wrap', backgroundPadding: 0, backgroundPaddingY: 0, borderRadius: 0, textOutline: { on: false, color: '#000000', width: 0 }, dropShadow: { on: true, color: '#000000', blur: 0.1667, distance: 0.0833, rotation: 90, opacity: 0.46 } } },
  // textMotion.in: rise，out: fade-down
  { id: 'studio-rise-settle', style: { fontFamily: 'Playfair Display', fontWeight: 400, bold: false, italic: true, fontColor: '#F5E6CF', lineHeight: 1.12, letterSpacing: -0.36, textTransform: 'none', textAlign: 'center', background: false, backgroundColor: '#00000000', backgroundStyle: 'wrap', backgroundPadding: 0, backgroundPaddingY: 0, borderRadius: 0, textOutline: { on: false, color: '#000000', width: 0 }, dropShadow: { on: true, color: '#301E16', blur: 0.1379, distance: 0.1384, rotation: 48.3665, opacity: 0.55 } } },
  // textMotion.in: wave-in，loop: wave（逐字）
  { id: 'studio-kinetic-wave', style: { fontFamily: 'Oswald', fontWeight: 700, bold: false, italic: false, fontColor: '#FFFFFF', lineHeight: 0.98, letterSpacing: -0.75, textTransform: 'none', textAlign: 'center', background: false, backgroundColor: '#00000000', backgroundStyle: 'wrap', backgroundPadding: 0, backgroundPaddingY: 0, borderRadius: 0, textOutline: { on: true, color: '#FFE547', width: 15.1515 }, dropShadow: { on: true, color: '#32DDE7', blur: 0, distance: 0.1625, rotation: 34.0193, opacity: 1 } } },
  // textMotion.karaoke（走字 #FF6A1A、引导、下一行）
  { id: 'studio-ktv', style: { fontFamily: 'Poppins', fontWeight: 900, bold: false, italic: false, fontColor: '#FFF6D8', lineHeight: 1.18, letterSpacing: 0, textTransform: 'none', textAlign: 'center', background: false, backgroundColor: '#00000000', backgroundStyle: 'wrap', backgroundPadding: 0, backgroundPaddingY: 0, borderRadius: 0, textOutline: { on: true, color: '#3A1A08', width: 20 }, dropShadow: { on: true, color: '#000000', blur: 0.08, distance: 0.1, rotation: 60, opacity: 0.7 } } },
];

const lookPreset = (id: string, name: string, group: PresetGroupKey): CaptionPreset => ({ id, name, group, style: lookStyle(GALLERY_LOOKS[id]!) });

/** 画廊的卡，按陈列次序（data.js 目录次序、按家族去重之后）。 */
export const CAPTION_PRESETS: readonly CaptionPreset[] = [
  {
    id: 'classic',
    get name() {
      return M.classic;
    },
    group: 'default',
    style: CLASSIC,
  },
  { id: 'shorts', name: 'Shorts', group: 'shorts', style: SHORTS },
  lookPreset('ali', 'Ali', 'social'),
  lookPreset('karl', 'Karl', 'social'),
  lookPreset('lime', 'Lime', 'social'),
  lookPreset('phantom', 'Phantom', 'social'),
  lookPreset('bulb', 'Bulb', 'social'),
  lookPreset('vegas', 'Vegas', 'social'),
  ...STUDIO_DESIGNS.map(
    (d): CaptionPreset => ({
      id: d.id,
      get name() {
        return M.studio[d.id] ?? d.id;
      },
      group: 'social',
      style: complete(d.style),
      motion: true,
    }),
  ),
  lookPreset('simple', 'Simple', 'business'),
];

/** 分区陈列：按 `PRESET_GROUPS` 的次序，空区不出（原型 `BC_SUB.gallery`）。 */
export function presetGroups(): { key: PresetGroupKey; label: string; presets: CaptionPreset[] }[] {
  return PRESET_GROUPS.map((g) => ({ ...g, presets: CAPTION_PRESETS.filter((p) => p.group === g.key) })).filter((g) => g.presets.length > 0);
}

/** 套到哪儿：`all` 是用这份样式的每一行；`original` / `translation` 只给那一行上妆（写进 `origStyle` / `transStyle`）。 */
export type PresetScope = 'all' | LineKind;

function withoutPaint(style: Json): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(style)) if (!PAINT_KEYS.includes(key)) out[key] = value;
  return out;
}

/**
 * 套一张卡之后的样式文档正文（同 `patchCaptionStyle`：正文别的字段原样保留）。
 * - `all`：根样式的涂装键整组换成这张卡；`origStyle` / `transStyle` 里的涂装键清掉（字号这类非涂装的覆盖留着），清空了就去掉。
 * - 一行：涂装写进那一行的覆盖里；根样式上有、这张卡没有的涂装键在覆盖里写 `null`（两个渲染器都把 null 当没设），
 *   免得根样式的旧值从底下透上来。另一行不动。
 */
export function applyPreset(body: unknown, preset: CaptionPreset, scope: PresetScope): Json {
  const doc = asObject(body);
  const root = asObject(doc.style);
  let next: Json;
  if (scope === 'all') {
    next = { ...withoutPaint(root), ...preset.style };
    for (const key of Object.values(LINE_STYLE_KEY)) {
      if (!(key in root)) continue;
      const rest = withoutPaint(asObject(root[key]));
      if (Object.keys(rest).length) next[key] = rest;
      else delete next[key];
    }
  } else {
    const key = LINE_STYLE_KEY[scope];
    const masked: Json = {};
    for (const name of PAINT_KEYS) if (name in root && !(name in preset.style)) masked[name] = null;
    next = { ...root, [key]: { ...withoutPaint(asObject(root[key])), ...masked, ...preset.style } };
  }
  return { ...doc, schema: STUDIO_STYLE, style: next };
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!same(a[key], b[key])) return false;
    return true;
  }
  return a === b;
}

/** 这张卡是不是正套在这几行上：每一行叠完覆盖之后的涂装键都与卡上的相同。改过一项就不算了（原型「自定义」）。 */
export function presetOn(root: Json, preset: CaptionPreset, kinds: readonly LineKind[]): boolean {
  if (kinds.length === 0) return false;
  return kinds.every((kind) => {
    const line = mergedLineStyle(root, kind);
    return Object.entries(preset.style).every(([key, value]) => same(line[key], value));
  });
}

/** 正套在这几行上的那张卡；混搭或改过时没有。 */
export function currentPreset(root: Json, kinds: readonly LineKind[]): CaptionPreset | null {
  return CAPTION_PRESETS.find((preset) => presetOn(root, preset, kinds)) ?? null;
}

/**
 * 画廊套到哪一份样式文档：轨条选中的那条用的；它还没有样式时取画面上别的字幕在用的那份；都没有是 null（套的时候新建）。
 * `kinds` 是套上去之后这份样式管的几种行：画面上用它的，加上还没有样式、会一起挂上来的。
 */
export function galleryTarget(chips: readonly CaptionChip[], selected: string | null): { styleDocumentId: Id | null; kinds: LineKind[] } {
  const showing = chips.filter((chip) => chip.state !== 'shelved');
  const current = showing.find((chip) => chip.key === selected) ?? showing[0] ?? null;
  const styleDocumentId = current?.styleDocumentId ?? showing.find((chip) => chip.styleDocumentId)?.styleDocumentId ?? null;
  const present = new Set(showing.filter((chip) => !chip.styleDocumentId || chip.styleDocumentId === styleDocumentId).map((chip) => chip.kind));
  return { styleDocumentId, kinds: (['original', 'translation'] as const).filter((kind) => present.has(kind)) };
}

/** 序列上还没有样式、能挂样式的字幕（锁住的实例与锁住轨道上的引擎会拒绝，跳过）。 */
function unstyledCaptions(sequence: Sequence): CaptionItem[] {
  const locked = new Set(sequence.tracks.filter((track) => track.locked).map((track) => track.id));
  return sequence.items.filter((item): item is CaptionItem => item.type === 'caption' && !item.styleDocumentId && !item.locked && !locked.has(item.trackId));
}

/**
 * 写一份字幕样式的事务（一笔撤销）：有样式文档就写它的新版本；没有就新建一份（ref `style`，同 inspector-caption）。
 * 两种情况都把还没有样式的字幕挂上这份——原文与译文用同一份样式才叠成双语两行（预览按样式文档分组）。
 */
export function captionStyleOperations(sequence: Sequence, record: DocumentRecord | undefined, body: Json): EditOperation[] {
  const target = record ? { documentId: record.id } : { ref: 'style' };
  const attach = unstyledCaptions(sequence).map(
    (item): EditOperation => ({ type: 'setCaptionStyle', sequenceId: sequence.id, itemId: item.id, styleDocument: target }),
  );
  const put: EditOperation = record
    ? { type: 'putDocument', documentId: record.id, kind: record.kind, body }
    : { type: 'putDocument', ref: 'style', kind: 'caption-style', name: defaultStyleName(), body };
  return [put, ...attach];
}

/** 画廊缩略图的英中样张（data.js `subtitle.sample` 的 thumb 那句；样张按位次给：上面那行英文、下面那行中文）。 */
// i18n-ignore: 双语样张，下面那行固定是中文，用来演示双语两行，不随界面语言
export const THUMB_SAMPLE = { main: 'Words are truth', sub: '词是真相' } as const;

/** 缩略图的灰底（原型 .sthumb 的 135° 渐变，左上到右下）：画在画布上的数据，不随界面主题变（原型也钉成浅色）。 */
export const THUMB_BACKDROP = ['#CFD2D6', '#A8ACB3'] as const;

/**
 * 缩略图用的样式与行：涂装照搬，落位换成「居中、占满宽、固定字号」——原型缩略图按固定字号画（`SubThumb` fz 13），
 * 不随画面上的字号与位置走；双语比例、次序与间距保留，两行的相对大小与画面一致。
 * `px` 是大的那一行在缩略图上的像素（覆盖里单独写的字号不算，按比例链）。
 */
export function thumbScene(
  root: Json,
  kinds: readonly LineKind[],
  size: { width: number; height: number },
  px: number,
): { root: Json; lines: { kind: LineKind; text: string }[]; bilingual: boolean } {
  const sized = (style: unknown): Json => {
    const { fontSize: _size, fontSizeBasis: _basis, ...rest } = asObject(style);
    return rest;
  };
  const out: Json = {
    ...sized(root),
    x: 50,
    y: 50,
    width: 94,
    verticalAlign: 'center',
    fontSize: 30,
  };
  for (const key of Object.values(LINE_STYLE_KEY)) if (isObject(root[key])) out[key] = sized(root[key]);
  const shown = kinds.length ? kinds : (['original'] as const);
  const bilingual = shown.length > 1;
  const largest = Math.max(...shown.map((kind) => lineSize(out, kind, bilingual).size));
  out.scale = (px * 540) / (largest * Math.max(1, Math.min(size.width, size.height)));
  const top: LineKind = bilingual && (root.order ?? 'trans') !== 'trans' ? 'original' : bilingual ? 'translation' : shown[0]!;
  return { root: out, bilingual, lines: shown.map((kind) => ({ kind, text: kind === top ? THUMB_SAMPLE.main : THUMB_SAMPLE.sub })) };
}
