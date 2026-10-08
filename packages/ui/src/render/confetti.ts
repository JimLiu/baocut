import { elementPresets, engineRanges, lazyArray, lazyObject, type ConfettiPreset, type Range } from '@baocut/editor-wasm';
import { live } from '@baocut/protocol';
import { R } from './render-copy.ts';
import { isObject, type Json } from './text-style.ts';

/**
 * 彩纸（内置生成器 `baocut.confetti`，照设计稿 model-confetti.js）：十款配方是起点，颜色、形状、粒子运动、发射与种子
 * 都是参数，时长跟着片段走。两条硬约束：
 * 1. 闭式运动：每个粒子的位置、旋转、大小、透明度都是它自己年龄 τ 的显式函数，不积分、不存上一帧——拖播放头、
 *    倒放、抽帧都不会漂。
 * 2. 随机数只来自 splitmix64(seed, i·16 + c)：粒子 i 的第 c 个通道是纯函数；`randomSeed()` 只在新建元素时用一次。
 * 款式的次序、色板、形状与缺省发射读 `motion` 的内置配方，参数的范围读时间线的校验常量（都经编辑语义 WASM）；
 * 这里是新建、属性页用的参数补齐，款名、形状名这些界面文案在 `render-copy.ts`。粒子的求解与绘制在渲染内核里。
 */

const ranges = lazyObject(() => engineRanges().confetti);

/** 上限：色板几种颜色、连续发射每秒几枚、每次爆发几枚、爆发间隔几秒。 */
export const CONFETTI_LIMITS = lazyObject(
  () =>
    ({
      colors: ranges.maxColors,
      rate: ranges.rate[1],
      count: ranges.count[1],
      interval: ranges.interval[1],
    }) as const,
);

/** 形状名（界面文案），读的时候按当前界面语言取。 */
export const CONFETTI_SHAPE_NAMES = live(() => R.confetti.shapes);
export type ConfettiShape = keyof typeof CONFETTI_SHAPE_NAMES;

const isShape = (value: unknown): value is ConfettiShape => typeof value === 'string' && Object.hasOwn(CONFETTI_SHAPE_NAMES, value);

/** 12 种单位形，次序是属性页的次序。 */
export const CONFETTI_SHAPES: readonly ConfettiShape[] = lazyArray(() => ranges.shapes.filter(isShape));

export interface ConfettiEmit {
  mode: 'continuous' | 'burst';
  /** 连续发射：每秒出生几枚。 */
  rate: number;
  /** 爆发：每次几枚。 */
  count: number;
  /** 爆发：第 b 次在 b × 间隔秒；0 = 只放一次。 */
  interval: number;
  /** 片尾前一个寿命不再出生（结束时落尽）。 */
  settle: boolean;
}

/** 一款彩纸：配方（色板、形状、发射器与缺省发射）加上界面的款名与出处（改编自哪个 MIT 来源）。 */
export interface ConfettiStyle extends ConfettiPreset {
  key: string;
  name: string;
  from: string;
  shapes: readonly ConfettiShape[];
}

/** 十款配方，目录次序。配方算一次就留着；款名（界面文案）是读取器，每次按当前界面语言取。 */
export const CONFETTI_STYLES: readonly ConfettiStyle[] = lazyArray(() =>
  elementPresets().confetti.map((preset) => ({
    ...preset,
    key: preset.id,
    get name() {
      return R.confetti.styles[preset.id] ?? preset.id;
    },
    from: preset.sources[0]?.split('/')[0] ?? '',
    shapes: preset.shapes.filter(isShape),
  })),
);

export function confettiStyle(key: unknown): ConfettiStyle {
  return CONFETTI_STYLES.find((style) => style.key === key) ?? CONFETTI_STYLES[0]!;
}

/** 参数的范围（倍率、风、不透明度、发射与起点）。 */
export const CONFETTI_RANGES = lazyObject(
  () =>
    ({
      size: ranges.size,
      speed: ranges.speed,
      gravity: ranges.gravity,
      drift: ranges.drift,
      spin: ranges.spin,
      wind: ranges.wind,
      opacity: ranges.opacity,
      rate: ranges.rate,
      count: ranges.count,
      interval: ranges.interval,
      angle: ranges.angle,
      spread: ranges.spread,
      originX: ranges.origin,
      originY: ranges.origin,
    }) as const satisfies Record<string, Range>,
);

const within = (value: number, range: Range) => Math.min(range[1], Math.max(range[0], value));

/** 一份完整的彩纸参数。`origin` / `angle` / `spread` 为 null 时跟着配方的发射器走。 */
export interface ConfettiProps {
  style: string;
  seed: number;
  colors: string[];
  shapes: ConfettiShape[];
  size: number;
  speed: number;
  gravity: number;
  drift: number;
  spin: number;
  wind: number;
  opacity: number;
  emit: ConfettiEmit;
  origin: { x: number; y: number } | null;
  angle: number | null;
  spread: number | null;
}

const MULTIPLIERS = ['size', 'speed', 'gravity', 'drift', 'spin', 'wind', 'opacity'] as const;

/** 种子：53 位以内的非负整数（两边 JSON 都能原样带），别的一律当 0。 */
export function confettiSeed(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(Math.abs(n)));
}

/** 某一款的完整参数（种子由调用方给：新建时 `randomSeed()`，换款时保留）。 */
export function confettiDefaults(styleKey?: unknown, seed?: unknown): ConfettiProps {
  const style = confettiStyle(styleKey);
  return {
    style: style.key,
    seed: confettiSeed(seed),
    colors: style.colors.slice(0, CONFETTI_LIMITS.colors),
    shapes: style.shapes.slice(),
    size: 1,
    speed: 1,
    gravity: 1,
    drift: 1,
    spin: 1,
    wind: 0,
    opacity: 1,
    emit: { ...style.emit, settle: false },
    origin: null,
    angle: null,
    spread: null,
  };
}

/** 补齐一份可能残缺的参数（旧文档、手写 JSON），越界值夹回范围。 */
export function normalizeConfetti(value: unknown): ConfettiProps {
  const raw: Json = isObject(value) ? value : {};
  const base = confettiDefaults(raw.style, raw.seed);
  const colors = Array.isArray(raw.colors) ? raw.colors.filter((c): c is string => typeof c === 'string' && c.length > 0) : [];
  const shapes = Array.isArray(raw.shapes) ? raw.shapes.filter((k): k is ConfettiShape => (CONFETTI_SHAPES as readonly unknown[]).includes(k)) : [];
  const out: ConfettiProps = {
    ...base,
    colors: (colors.length ? colors : base.colors).slice(0, CONFETTI_LIMITS.colors),
    shapes: shapes.length ? shapes : base.shapes,
  };
  for (const key of MULTIPLIERS) {
    const n = raw[key];
    out[key] = within(typeof n === 'number' && Number.isFinite(n) ? n : base[key], CONFETTI_RANGES[key]);
  }
  const emit: Json = isObject(raw.emit) ? raw.emit : {};
  const positive = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) && n !== 0 ? n : fallback);
  out.emit = {
    mode: (emit.mode ?? base.emit.mode) === 'burst' ? 'burst' : 'continuous',
    rate: Math.round(within(positive(emit.rate, base.emit.rate), CONFETTI_RANGES.rate)),
    count: Math.round(within(positive(emit.count, base.emit.count), CONFETTI_RANGES.count)),
    interval: within(typeof emit.interval === 'number' && Number.isFinite(emit.interval) ? emit.interval : base.emit.interval, CONFETTI_RANGES.interval),
    settle: emit.settle === true,
  };
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  out.angle = finite(raw.angle) ? within(raw.angle, CONFETTI_RANGES.angle) : null;
  out.spread = finite(raw.spread) ? within(raw.spread, CONFETTI_RANGES.spread) : null;
  const origin = isObject(raw.origin) ? raw.origin : null;
  out.origin =
    origin && finite(origin.x) && finite(origin.y) ? { x: within(origin.x, CONFETTI_RANGES.originX), y: within(origin.y, CONFETTI_RANGES.originY) } : null;
  return out;
}

/** 换款：参数回到那一款的缺省，只有种子跟着人走（换款是重选，不是编辑）。 */
export function switchConfettiStyle(props: unknown, styleKey: string): ConfettiProps {
  return confettiDefaults(styleKey, isObject(props) ? props.seed : undefined);
}

/** 新建元素时写入的随机种子：53 位以内的非零安全整数。 */
export function randomSeed(): number {
  const hi = Math.floor(Math.random() * 0x200000); // 21 位
  const lo = Math.floor(Math.random() * 0x100000000); // 32 位
  return hi * 0x100000000 + lo || 1;
}

/** 面板上显示的发射参数：没自定时回落到配方的第一枚发射器；多发射器的款标 `multi`。 */
export function effectiveEmit(props: ConfettiProps): { x: number; y: number; angle: number; spread: number; multi: boolean } {
  const recipe = confettiStyle(props.style);
  const emitter = recipe.emitters[0]!;
  return {
    x: props.origin ? props.origin.x : emitter.x,
    y: props.origin ? props.origin.y : emitter.y,
    angle: props.angle ?? emitter.angle ?? recipe.angle,
    spread: props.spread ?? recipe.spread,
    multi: !props.origin && recipe.emitters.length > 1,
  };
}
