import { lazyArray, placeDefault } from '@baocut/editor-wasm';
import type { ConfettiProps } from '@baocut/protocol';
import { CONFETTI_STYLES, confettiDefaults, confettiStyle, randomSeed } from '../render/confetti.ts';
import { PROGRESS_STYLES } from '../render/progress.ts';
import { WAVE_STYLES } from '../render/visualizer.ts';
import { defineMessages, live } from '@baocut/protocol';
import { placeBox, type VisualLayer } from './new-items.ts';
import { zhHans } from './element-catalog.zh-Hans.ts';
import { zhHant } from './element-catalog.zh-Hant.ts';
import { ja } from './element-catalog.ja.ts';
import { ko } from './element-catalog.ko.ts';
import { es } from './element-catalog.es.ts';
import { fr } from './element-catalog.fr.ts';
import { de } from './element-catalog.de.ts';
import { nl } from './element-catalog.nl.ts';
import { ptBR } from './element-catalog.pt-BR.ts';
import { it } from './element-catalog.it.ts';
import { ru } from './element-catalog.ru.ts';
import { pl } from './element-catalog.pl.ts';
import { tr } from './element-catalog.tr.ts';
import { vi } from './element-catalog.vi.ts';

/**
 * 元素面板的格子（照旧版 bcut-editor-core `element_tiles` 与 `default_place_of`、原型 `model-elpanel.js`）：
 * 贴纸、动态贴纸（彩纸）、形状、可视化（进度条、计时、声波）。只收画得出来的那几款；每格自带默认外观、长度与落位。
 */

export type ElementGroup = 'sticker' | 'confetti' | 'shape' | 'progress' | 'counter' | 'wave';

export interface ElementTile {
  /** 全局唯一（同一个形状占两格时靠它区分）。 */
  key: string;
  group: ElementGroup;
  label: string;
  /** 新建时落多长：秒数，或跟着整部片子（`film`）。 */
  seconds: number | 'film';
  /** 进度网格里横跨两列（条形的两款，设计稿的 `isSquare` 为假）。 */
  wide?: boolean;
  /** 彩纸的款式：缩略图按它现算一帧，不走新建的那一层（那一层每次带一枚新种子）。 */
  confetti?: string;
  /** 新建的那一层（画布决定布局框）。 */
  layer(canvas: { width: number; height: number }): VisualLayer;
}

/** 画布无关的落位：中心与框宽（画幅百分比）。 */
type At = { x: number; y: number; w?: number };

/** 色板的槽位（显示名在目录的 `colors` 里）。 */
type ColorSlot =
  | 'bar'
  | 'track'
  | 'background'
  | 'color1'
  | 'color2'
  | 'foreground'
  | 'bars'
  | 'waveform'
  | 'fill'
  | 'line'
  | 'dots'
  | 'peak'
  | 'core'
  | 'rings'
  | 'ribbonA'
  | 'ribbonB';

/** 元素目录的显示名（英文是键与类型的来源，译文在 `element-catalog.zh-Hans.ts`）。新建实例的名字按建的那一刻的界面语言写。 */
const en = {
  stickers: {
    badge_check: 'Check badge',
    badge_cross: 'Cross badge',
    star_burst: 'Starburst',
    speech_bubble: 'Speech bubble',
    heart: 'Heart',
    bolt: 'Lightning bolt',
    pin: 'Pushpin',
    sparkle: 'Sparkle',
    arrow_curved: 'Curved arrow',
    crown: 'Crown',
  } as Record<string, string>,
  shapes: {
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    triangle: 'Triangle',
    rombus: 'Rhombus',
    pentagon: 'Pentagon',
    hex: 'Hexagon',
    octagon: 'Octagon',
    squig: 'Scalloped circle',
    squig2: 'Block arrow',
    tick: 'Check mark',
    tick2: 'Cross',
    chevron: 'Chevron',
    chevron2: 'Zigzag band',
    cross2: 'Rounded plus',
    cross: 'Plus',
    love2: 'Rounded heart',
    love: 'Heart',
    diamond: 'Gem',
    star: 'Five-pointed star',
    sharp: 'Ten-pointed star',
    star2: 'Twelve-pointed star',
    sharp2: 'Speech bubble',
  } as Record<string, string>,
  progress: {
    normal: 'Square bar',
    rounded: 'Rounded bar',
    circle: 'Ring',
    donut: 'Donut',
    border: 'Border',
    reverse_border: 'Reverse border',
    rainbow_border: 'Rainbow border',
    reverse_rainbow_border: 'Reverse rainbow border',
    strobe_border: 'Strobe border',
    reverse_strobe_border: 'Reverse strobe border',
    snake: 'Snake',
    snake_spin: 'Spinning snake',
    snake_rainbow: 'Rainbow snake',
    snake_spin_rainbow: 'Spinning rainbow snake',
  } as Record<string, string>,
  waves: {
    bars: 'Bars',
    bars_rounded: 'Rounded bars',
    bars_bottom: 'Bottom-aligned bars',
    ring_bars: 'Ring bars',
    oscilloscope: 'Oscilloscope',
    ring_wave: 'Ring wave',
    spectrum_area: 'Spectrum area',
    dots: 'Dot matrix',
    pulse_rings: 'Pulse rings',
    ribbons: 'Ribbons',
  } as Record<string, string>,
  colors: {
    bar: 'Bar',
    track: 'Track',
    background: 'Background',
    color1: 'Color 1',
    color2: 'Color 2',
    foreground: 'Foreground',
    bars: 'Bars',
    waveform: 'Waveform',
    fill: 'Fill',
    line: 'Line',
    dots: 'Dots',
    peak: 'Peak',
    core: 'Core',
    rings: 'Rings',
    ribbonA: 'Ribbon A',
    ribbonB: 'Ribbon B',
  } as Record<ColorSlot, string>,
  roundedRect: 'Rounded rectangle',
  countdown: 'Countdown',
  countup: 'Count up',
  progressName: (label: string) => `Progress bar · ${label}`,
  waveName: (label: string) => `Waveform · ${label}`,
  confettiName: (label: string) => `Confetti · ${label}`,
  shapeName: (name: string) => `Shape · ${name}`,
  stickerName: (label: string) => `Sticker · ${label}`,
  sections: {
    sticker: { title: 'Stickers', note: '10 built-in + brand library' },
    dynamic: {
      title: 'Animated stickers',
      note: '10 confetti + Lottie from the brand library',
    },
    shape: { title: 'Shapes', note: '23 tiles · 5-color cycle' },
    visualizer: {
      title: 'Visualizers',
      note: '14 progress + 2 timers + 10 waveforms',
    },
  } as Record<ElementSection['key'], { title: string; note: string }>,
};
export type ElementCatalogMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 内置贴纸（`sticker-templates.ts` 的十款），宽 18%，正方。 */
const STICKERS: readonly string[] = Object.keys(en.stickers);

export const SHAPE_NAMES: Record<string, string> = live(() => M.shapes);

/** 按格子下标取模的五色环（填充、描边）：颜色是网格位置的属性，不是形状的。 */
const COLOR_CYCLE: [string, string][] = [
  ['#FF4C45', '#E43A33'],
  ['#3CADFF', '#3598DF'],
  ['#FFD646', '#E2BE3C'],
  ['#A46CFF', '#8A5BD8'],
  ['#3CADFF', '#3598DF'],
];

/**
 * 形状网格的 24 格（`[形状, 圆角]`），下标就是取色下标。第二格是圆角矩形（540 短边上 14.4 像素）；
 * 第 11 格的箭头是端点形状、不出格，留在表里只为占住取色下标。
 */
const SHAPE_ORDER: [string, number | null][] = [
  ['rect', null],
  ['rect', 14.4],
  ['ellipse', null],
  ['triangle', null],
  ['rombus', null],
  ['pentagon', null],
  ['hex', null],
  ['octagon', null],
  ['squig', null],
  ['squig2', null],
  ['arrow', null],
  ['tick', null],
  ['tick2', null],
  ['chevron', null],
  ['chevron2', null],
  ['cross2', null],
  ['cross', null],
  ['love2', null],
  ['love', null],
  ['diamond', null],
  ['star', null],
  ['sharp', null],
  ['star2', null],
  ['sharp2', null],
];

/** 一款可视化样式在界面上的名字与各色板的名字（设计稿 `model-elements.js` 的 PROGRESS / WAVES 表）；色板为空的那几款没有颜色控件。 */
export interface StyleKind {
  key: string;
  label: string;
  colors: readonly string[];
}

const styleKinds = (rows: readonly [string, readonly ColorSlot[]][], labels: () => Record<string, string>): readonly StyleKind[] =>
  rows.map(([key, slots]) => ({
    key,
    get label() {
      return labels()[key] ?? key;
    },
    get colors() {
      return slots.map((slot) => M.colors[slot]);
    },
  }));

/** 进度条 14 款，次序是核心的 `order`（属性页样式目录照它排）。 */
export const PROGRESS_KINDS: readonly StyleKind[] = styleKinds(
  [
    ['normal', ['bar', 'track']],
    ['rounded', ['bar', 'track']],
    ['circle', ['bar', 'track']],
    ['donut', ['bar', 'track']],
    ['border', ['bar', 'background']],
    ['reverse_border', ['bar', 'background']],
    ['rainbow_border', []],
    ['reverse_rainbow_border', []],
    ['strobe_border', ['color1', 'color2']],
    ['reverse_strobe_border', ['color1', 'color2']],
    ['snake', ['foreground', 'background']],
    ['snake_spin', ['foreground', 'background']],
    ['snake_rainbow', ['background']],
    ['snake_spin_rainbow', ['background']],
  ],
  () => M.progress,
);

/** 声波 10 款，次序是核心的 `order`。 */
export const WAVE_KINDS: readonly StyleKind[] = styleKinds(
  [
    ['bars', ['bars']],
    ['bars_rounded', ['bars']],
    ['bars_bottom', ['bars']],
    ['ring_bars', ['bars']],
    ['oscilloscope', ['waveform']],
    ['ring_wave', ['waveform']],
    ['spectrum_area', ['fill', 'line']],
    ['dots', ['dots', 'peak']],
    ['pulse_rings', ['core', 'rings']],
    ['ribbons', ['ribbonA', 'ribbonB']],
  ],
  () => M.waves,
);

/** 进度网格的次序（固定网格序去掉计时两格）；计时那两格插在第 11 格（`snake`）之后。 */
const PROGRESS_GRID = [
  'rounded',
  'normal',
  'border',
  'reverse_border',
  'donut',
  'rainbow_border',
  'reverse_rainbow_border',
  'circle',
  'strobe_border',
  'reverse_strobe_border',
  'snake',
  'snake_spin',
  'snake_rainbow',
  'snake_spin_rainbow',
];
const COUNTER_AT = 11;

/**
 * 进度条与声波的默认落位：种类的缺省框（`render-graph` 的 `place_defaults`，经 `editor-wasm`）——进度条 80% 宽、画幅高的 5%，
 * 声波贴底铺满、画幅高的 20%。帧计划按种类定框，不看款式的宽高比，方形与边框款也落在这个框里。
 */
function kindPlace(type: 'progress' | 'visualizer'): At {
  const { x, y, w } = placeDefault(type);
  return { x, y, w };
}

const labelOf = (kinds: readonly StyleKind[], key: string) => kinds.find((kind) => kind.key === key)?.label ?? key;

function progressTile(style: string): ElementTile {
  const preset = PROGRESS_STYLES[style]!;
  return {
    key: `progress.${style}`,
    group: 'progress',
    get label() {
      return labelOf(PROGRESS_KINDS, style);
    },
    seconds: 'film',
    wide: preset.aspect === 'bar',
    layer: () => ({
      type: 'progress',
      name: M.progressName(labelOf(PROGRESS_KINDS, style)),
      place: placeBox(kindPlace('progress')),
      progress: {
        style,
        mainColor: preset.mainColor,
        secondaryColor: preset.secondaryColor,
      },
    }),
  };
}

function waveTile(style: string): ElementTile {
  const preset = WAVE_STYLES[style]!;
  return {
    key: `wave.${style}`,
    group: 'wave',
    get label() {
      return labelOf(WAVE_KINDS, style);
    },
    seconds: 'film',
    layer: () => ({
      type: 'visualizer',
      name: M.waveName(labelOf(WAVE_KINDS, style)),
      place: placeBox(kindPlace('visualizer')),
      // dB 窗跟着款走：示波器与环形波是 −120 / −10 那扇窄窗。
      visualizer: {
        style,
        mainColor: preset.mainColor,
        secondaryColor: preset.secondaryColor,
        minDb: preset.minDb,
        maxDb: preset.maxDb,
      },
    }),
  };
}

/** 彩纸新建多长（设计稿 `NEW_SPAN`）：时长任意，粒子按片段时长算。 */
const CONFETTI_SECONDS = 5;

/**
 * 彩纸（设计稿 `newElement` 的 confetti 分支）：落那一款的配方缺省，种子在点下这一刻随机写入（之后换款也留着）；
 * 铺满画面——它是一层粒子场，不是一枚贴纸。跟配方走的起点、方向、扇面不写（缺省就是跟配方）。
 */
function confettiTile(styleKey: string): ElementTile {
  return {
    key: `confetti.${styleKey}`,
    group: 'confetti',
    get label() {
      return confettiStyle(styleKey).name;
    },
    seconds: CONFETTI_SECONDS,
    confetti: styleKey,
    layer: () => {
      const confetti = Object.fromEntries(Object.entries(confettiDefaults(styleKey, randomSeed())).filter(([, value]) => value !== null));
      return {
        type: 'confetti',
        name: M.confettiName(confettiStyle(styleKey).name),
        place: placeBox({ x: 50, y: 50, w: 100 }),
        confetti: confetti as unknown as ConfettiProps,
      };
    },
  };
}

/** 计时数字的样式（540 短边上的字号）。 */
const COUNTER_FONT = 48;
export const COUNTER_STYLE = {
  fontSize: COUNTER_FONT,
  fontWeight: 'bold',
  fontColor: '#FFFFFF',
  textAlign: 'center',
};

function shapeTiles(): ElementTile[] {
  return SHAPE_ORDER.flatMap(([kind, corner], index): ElementTile[] => {
    if (!SHAPE_NAMES[kind]) return [];
    const [fill, stroke] = COLOR_CYCLE[index % COLOR_CYCLE.length]!;
    const nameOf = () => (corner === null ? SHAPE_NAMES[kind]! : M.roundedRect);
    return [
      {
        key: `shape.${index}.${kind}`,
        group: 'shape',
        get label() {
          return nameOf();
        },
        seconds: 10,
        layer: () => ({
          type: 'shape',
          name: M.shapeName(nameOf()),
          place: placeBox({ x: 50, y: 50, w: 15 }),
          shape: {
            shape: kind,
            fill,
            stroke,
            strokeWidth: 3,
            ...(corner === null ? {} : { cornerRadius: [corner, corner, corner, corner] }),
          },
        }),
      },
    ];
  });
}

function counterTile(mode: 'countdown' | 'countup'): ElementTile {
  return {
    key: `counter.${mode}`,
    group: 'counter',
    get label() {
      return M[mode];
    },
    seconds: 10,
    // 计时是文字实例的计时读数：框按文字的口径（宽 28%，高由种类推出）。
    layer: () => ({
      type: 'text',
      name: M[mode],
      place: placeBox({ x: 50, y: 50, w: 28 }),
      counter: { mode },
      style: { ...COUNTER_STYLE },
    }),
  };
}

/** 进度网格（计时两格夹在里面）、再是声波：可视化子页照这个次序摆。 */
const PROGRESS_TILES = lazyArray(() => PROGRESS_GRID.map(progressTile));
const COUNTER_TILES = (['countdown', 'countup'] as const).map(counterTile);

export const ELEMENT_TILES: readonly ElementTile[] = lazyArray(() => [
  ...STICKERS.map(
    (templateId): ElementTile => ({
      key: `sticker.${templateId}`,
      group: 'sticker',
      get label() {
        return M.stickers[templateId] ?? templateId;
      },
      seconds: 8,
      layer: () => ({
        type: 'sticker',
        name: M.stickerName(M.stickers[templateId] ?? templateId),
        place: placeBox({ x: 50, y: 50, w: 18 }),
        sticker: { source: 'template', templateId },
      }),
    }),
  ),
  ...CONFETTI_STYLES.map((style) => confettiTile(style.key)),
  ...shapeTiles(),
  ...PROGRESS_TILES.slice(0, COUNTER_AT),
  ...COUNTER_TILES,
  ...PROGRESS_TILES.slice(COUNTER_AT),
  ...WAVE_KINDS.map((kind) => waveTile(kind.key)),
]);

/** 目录页可视化那一段的四格（设计稿 `VIZ_PICK`，手挑的）：两款进度 ＋ 一款声波 ＋ 一款计时。 */
export const VISUALIZER_PEEK: readonly string[] = ['progress.rainbow_border', 'progress.rounded', 'wave.ribbons', 'counter.countdown'];

export interface ElementSection {
  key: 'sticker' | 'dynamic' | 'shape' | 'visualizer';
  title: string;
  note: string;
  tiles: ElementTile[];
}

/**
 * 目录页的分节（原型：贴纸 → 动态贴纸 → 形状 → 可视化），可视化里进度、计时、声波挨着排。搜索时没有命中的一段不摆，
 * `keep` 里的除外（品牌库贴纸不在这张表里，它们命中了，那一段就得留着）。
 */
export function elementSections(query = '', keep: readonly ElementSection['key'][] = []): ElementSection[] {
  const q = query.trim().toLowerCase();
  const hit = (tile: ElementTile, title: string) => !q || tile.label.toLowerCase().includes(q) || `${title} ${GROUP_WORDS[tile.group]}`.includes(q);
  const pick = (groups: ElementGroup[], title: string) => ELEMENT_TILES.filter((tile) => groups.includes(tile.group) && hit(tile, title));
  const section = (key: ElementSection['key'], groups: ElementGroup[]): ElementSection => {
    const { title, note } = M.sections[key];
    return { key, title, note, tiles: pick(groups, title) };
  };
  return [
    section('sticker', ['sticker']),
    section('dynamic', ['confetti']),
    section('shape', ['shape']),
    section('visualizer', ['progress', 'counter', 'wave']),
  ].filter((section) => section.tiles.length > 0 || keep.includes(section.key));
}

// i18n-ignore-start: 检索关键词，中英两种说法都收，与界面语言无关
const GROUP_WORDS: Record<ElementGroup, string> = {
  sticker: 'sticker',
  confetti: '彩纸 confetti 粒子 particles',
  shape: 'shape',
  progress: '进度 progress',
  counter: '计时 counter',
  wave: '声波 wave',
};
// i18n-ignore-end

/** 属性页「形状」下拉的选项：矩形、椭圆与 20 款轮廓（不含端点形状）。 */
export const SHAPE_CHOICES = Object.keys(en.shapes).map((key) => ({
  key,
  get label() {
    return SHAPE_NAMES[key]!;
  },
}));
