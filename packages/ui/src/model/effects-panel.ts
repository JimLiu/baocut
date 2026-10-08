import { engineRanges, lazyArray, lazyObject } from '@baocut/editor-wasm';
import { defineMessages, type EditOperation, type Fx, type Id, type SequenceItem } from '@baocut/protocol';
import { zhHans } from './effects-panel.zh-Hans.ts';
import { zhHant } from './effects-panel.zh-Hant.ts';
import { ja } from './effects-panel.ja.ts';
import { ko } from './effects-panel.ko.ts';
import { es } from './effects-panel.es.ts';
import { fr } from './effects-panel.fr.ts';
import { de } from './effects-panel.de.ts';
import { nl } from './effects-panel.nl.ts';
import { ptBR } from './effects-panel.pt-BR.ts';
import { it } from './effects-panel.it.ts';
import { ru } from './effects-panel.ru.ts';
import { pl } from './effects-panel.pl.ts';
import { tr } from './effects-panel.tr.ts';
import { vi } from './effects-panel.vi.ts';

type ColorKey = 'brightness' | 'contrast' | 'saturation' | 'temperature' | 'hue';
type OtherKey = 'filterPreset' | 'effectPreset' | 'grayscale' | 'exposure' | 'sharpen' | 'noise' | 'vignette';

/** 「效果」一节的字段名（英文是键与类型的来源，译文在 `effects-panel.zh-Hans.ts`）。 */
const en = {
  color: {
    brightness: 'Brightness',
    contrast: 'Contrast',
    saturation: 'Saturation',
    temperature: 'Temperature',
    hue: 'Hue',
  } as Record<ColorKey, string>,
  other: {
    filterPreset: 'Filter preset',
    effectPreset: 'Effect preset',
    grayscale: 'Grayscale',
    exposure: 'Exposure',
    sharpen: 'Sharpen',
    noise: 'Noise',
    vignette: 'Vignette',
  } as Record<OtherKey, string>,
};
export type EffectsPanelMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 属性页「效果」一节的纯逻辑（视频格式规范 §3.8 的 `fx`，命令 `setEffects` 整体替换）。
 *
 * `fx` 是固定字段：页上每张卡管其中几项——颜色校正管五个调色字段，模糊管 `blur`，投影管 `shadow`，描边管 `stroke`。
 * 卡开着就是这几项写在 `fx` 里，关上就去掉（`fx` 没有单独的开关）。页上没有控件的字段（滤镜预设、灰度、曝光……）
 * 原样留着，提交时一并带回去。长度是 540 短边下的像素。
 */

/** 页上的四张卡，按页上的顺序。 */
export type EffectKind = 'color-adjust' | 'gaussian-blur' | 'drop-shadow' | 'stroke';
export const EFFECT_KINDS: readonly EffectKind[] = ['color-adjust', 'gaussian-blur', 'drop-shadow', 'stroke'];

const FX = lazyObject(() => engineRanges().fx);

/**
 * 颜色校正的五项：`scale` 是滑杆读数与字段的比（百分数 ÷ 100；色相是度，字段在 [-1, 1]、乘 180 是度）。读数的范围是引擎的
 * 字段区间（`editor-wasm` 的取值区间）乘上 `scale`。
 */
export const COLOR_FIELDS: readonly {
  key: ColorKey;
  label: string;
  min: number;
  max: number;
  scale: number;
  unit: string;
}[] = lazyArray(() =>
  (
    [
      { key: 'brightness', range: FX.adjust, scale: 100, unit: '%' },
      { key: 'contrast', range: FX.adjust, scale: 100, unit: '%' },
      { key: 'saturation', range: FX.adjust, scale: 100, unit: '%' },
      { key: 'temperature', range: FX.temperature, scale: 100, unit: '%' },
      { key: 'hue', range: FX.adjust, scale: 180, unit: '°' },
    ] as const
  ).map(({ range, ...field }) => ({
    ...field,
    get label() {
      return M.color[field.key];
    },
    min: range[0] * field.scale,
    max: range[1] * field.scale,
  })),
);

/** 数字框能敲到的上限（引擎的取值区间；滑杆的常用范围在页上另写）：模糊半径、投影模糊、投影不透明度、描边宽度。 */
export const FX_LIMITS = lazyObject(
  () =>
    ({
      blur: FX.blur[1],
      shadowBlur: FX.shadowBlur[1],
      shadowOpacity: FX.shadowOpacity[1],
      strokeWidth: FX.strokeWidthMax,
    }) as const,
);

type Shadow = NonNullable<Fx['shadow']>;
type Stroke = NonNullable<Fx['stroke']>;

/** 打开一张卡时的初始值。 */
export const EFFECT_DEFAULTS = {
  blur: 8,
  shadow: { offsetX: 0, offsetY: 8, blur: 12, color: '#000000', opacity: 0.5 } satisfies Shadow,
  stroke: { width: 4, color: '#FFFFFF' } satisfies Stroke,
} as const;

/** 有 `fx` 的片段：视觉媒体（视频、图片、贴纸、占位框、白板）与合成。 */
export type EffectItem = Extract<SequenceItem, { fx?: Fx }>;

export function hasEffects(item: SequenceItem): item is EffectItem {
  switch (item.type) {
    case 'video':
    case 'image':
    case 'sticker':
    case 'placeholder':
    case 'whiteboard':
    case 'composition':
      return true;
    default:
      return false;
  }
}

/** 这种片段有哪几张卡：有 `fx` 的四张都有，其余没有（文字与图形不收 `fx`）。 */
export function effectKindsFor(item: SequenceItem): EffectKind[] {
  return hasEffects(item) ? [...EFFECT_KINDS] : [];
}

/** 这张卡开着（它管的字段写在 `fx` 里）。 */
export function effectOn(fx: Fx | undefined, kind: EffectKind): boolean {
  if (!fx) return false;
  switch (kind) {
    case 'color-adjust':
      return COLOR_FIELDS.some((field) => fx[field.key] !== undefined);
    case 'gaussian-blur':
      return fx.blur !== undefined;
    case 'drop-shadow':
      return !!fx.shadow;
    case 'stroke':
      return !!fx.stroke;
  }
}

const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** 一张卡上一项的数：颜色校正是调色字段，模糊是 `radius`（即 `blur`），投影与描边是各自的字段；没有时用缺省值。 */
export function effectNumber(fx: Fx | undefined, kind: EffectKind, key: string): number {
  switch (kind) {
    case 'color-adjust':
      return finite(fx?.[key as (typeof COLOR_FIELDS)[number]['key']], 0);
    case 'gaussian-blur':
      return finite(fx?.blur, EFFECT_DEFAULTS.blur);
    case 'drop-shadow':
      return finite((fx?.shadow ?? EFFECT_DEFAULTS.shadow)[key as keyof Shadow], finite(EFFECT_DEFAULTS.shadow[key as keyof Shadow], 0));
    case 'stroke':
      return finite((fx?.stroke ?? EFFECT_DEFAULTS.stroke)[key as keyof Stroke], finite(EFFECT_DEFAULTS.stroke[key as keyof Stroke], 0));
  }
}

/** 投影与描边的颜色。 */
export function effectColor(fx: Fx | undefined, kind: 'drop-shadow' | 'stroke'): string | undefined {
  return kind === 'drop-shadow' ? fx?.shadow?.color : fx?.stroke?.color;
}

/** 改一张卡（数值合并进它管的字段）；卡还关着就按缺省值打开。 */
export function withEffect(fx: Fx | undefined, kind: EffectKind, change: Record<string, unknown>): Fx {
  const base: Fx = { ...fx };
  switch (kind) {
    case 'color-adjust': {
      for (const field of COLOR_FIELDS) {
        const value = change[field.key];
        if (typeof value === 'number') base[field.key] = value;
        else if (base[field.key] === undefined) base[field.key] = 0;
      }
      return base;
    }
    case 'gaussian-blur':
      return { ...base, blur: finite(change.radius, base.blur ?? EFFECT_DEFAULTS.blur) };
    case 'drop-shadow':
      return { ...base, shadow: { ...(base.shadow ?? EFFECT_DEFAULTS.shadow), ...change } as Shadow };
    case 'stroke':
      return { ...base, stroke: { ...(base.stroke ?? EFFECT_DEFAULTS.stroke), ...change } as Stroke };
  }
}

/** 关上一张卡：去掉它管的字段。 */
export function withoutEffect(fx: Fx | undefined, kind: EffectKind): Fx {
  const next: Fx = { ...fx };
  switch (kind) {
    case 'color-adjust':
      for (const field of COLOR_FIELDS) delete next[field.key];
      break;
    case 'gaussian-blur':
      delete next.blur;
      break;
    case 'drop-shadow':
      delete next.shadow;
      break;
    case 'stroke':
      delete next.stroke;
      break;
  }
  return next;
}

/** 开关一张卡：打开时按缺省值写上（已开着的不动），关上时去掉（再打开回到缺省值）。 */
export function toggleEffect(fx: Fx | undefined, kind: EffectKind, on: boolean): Fx {
  if (!on) return withoutEffect(fx, kind);
  return effectOn(fx, kind) ? { ...fx } : withEffect(fx, kind, {});
}

/** 全部重置：关上四张卡，页上没有控件的字段原样留着。 */
export function resetEffects(fx: Fx | undefined): Fx {
  return EFFECT_KINDS.reduce<Fx>((next, kind) => withoutEffect(next, kind), { ...fx });
}

/** 页上没有控件的字段（省略或恒等值的不算）：原样保留。 */
const OTHER_FIELDS: readonly { key: OtherKey; label: string }[] = (
  ['filterPreset', 'effectPreset', 'grayscale', 'exposure', 'sharpen', 'noise', 'vignette'] as const
).map((key) => ({
  key,
  get label() {
    return M.other[key];
  },
}));

/** `fx` 里页上没有控件、又确实生效的字段的名字。 */
export function unknownKinds(fx: Fx | undefined): string[] {
  if (!fx) return [];
  return OTHER_FIELDS.filter(({ key }) => {
    const value = fx[key];
    if (value === undefined || value === 'none') return false;
    return typeof value !== 'number' || (Number.isFinite(value) && value !== 0);
  }).map((field) => field.label);
}

/** 提交用的整份 `fx`：什么都没有时去掉（`null`）。 */
export function setEffectsOperation(sequenceId: Id, itemId: Id, fx: Fx | undefined): EditOperation {
  return { type: 'setEffects', sequenceId, itemId, fx: fx && Object.keys(fx).length ? fx : null };
}

/** 页上有开着的卡（分节头的「全部重置」用）。 */
export function hasKnownEffects(fx: Fx | undefined): boolean {
  return EFFECT_KINDS.some((kind) => effectOn(fx, kind));
}
