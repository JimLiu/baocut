import { defineMessages, type Place, type Rate, type ShapeProps } from '@baocut/protocol';
import { placeBox, type VisualLayer } from './new-items.ts';
import { TEXT_PRESETS, type TextPreset, type TextPresetLayer } from './text-preset-data.ts';
import { zhHans } from './text-presets.zh-Hans.ts';
import { zhHant } from './text-presets.zh-Hant.ts';
import { ja } from './text-presets.ja.ts';
import { ko } from './text-presets.ko.ts';
import { es } from './text-presets.es.ts';
import { fr } from './text-presets.fr.ts';
import { de } from './text-presets.de.ts';
import { nl } from './text-presets.nl.ts';
import { ptBR } from './text-presets.pt-BR.ts';
import { it } from './text-presets.it.ts';
import { ru } from './text-presets.ru.ts';
import { pl } from './text-presets.pl.ts';
import { tr } from './text-presets.tr.ts';
import { vi } from './text-presets.vi.ts';

export { TEXT_PRESETS, type TextPreset, type TextPresetLayer };

/** 文字面板的文案（英文是键与类型的来源，译文在 `text-presets.<语言>.ts`）。预设里的示例字不翻译，见 text-preset-data.ts。 */
const en = {
  catAll: 'All',
  catSimple: 'Simple',
  catTitle: 'Title',
  catLower: 'Lower third',
  catOther: 'Other',
  /** 「添加文本框」新建出来的占位文字。 */
  blankText: 'Type your text',
};
export type TextPresetsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 文字面板的分类（原型：全部 / 简单 / 标题 / 下三分 / 其它）。 */
export const TEXT_CATEGORIES = [
  {
    key: 'all',
    get label() {
      return M.catAll;
    },
  },
  {
    key: 'simple',
    get label() {
      return M.catSimple;
    },
  },
  {
    key: 'title',
    get label() {
      return M.catTitle;
    },
  },
  {
    key: 'lower',
    get label() {
      return M.catLower;
    },
  },
  {
    key: 'other',
    get label() {
      return M.catOther;
    },
  },
] as const;
export type TextCategory = (typeof TEXT_CATEGORIES)[number]['key'];

/** 「全部」那一档每个分区只摆前几格，多的走「查看全部」。 */
export const PEEK = 6;

export function presetsOf(category: Exclude<TextCategory, 'all'>): TextPreset[] {
  return TEXT_PRESETS.filter((preset) => preset.category === category);
}

/**
 * 一段文字排好之后要多大的框（序列像素，含底板留白）：`wrapWidth` 给了就按它折行，否则不折。
 * 由界面用画布量；这一层不碰 DOM。
 */
export type MeasureText = (text: string, style: Record<string, unknown>, wrapWidth: number | null) => { width: number; height: number };

/** 「添加文本框」：白字黑底的标题样式（旧版 `TEXT_TITLE`），播放头处 10 秒，画面中线偏上。 */
export const BLANK_TEXT_SECONDS = 10;
export const BLANK_TEXT = {
  get text() {
    return M.blankText;
  },
  style: {
    fontSize: 24,
    fontWeight: 'bold',
    fontColor: '#FFFFFF',
    lineHeight: 1.2,
    textAlign: 'center',
    backgroundColor: '#000000CC',
    backgroundStyle: 'wrap',
    backgroundPadding: 14,
    borderRadius: 12,
  },
};

/**
 * 一层预设的 `place`：形状按 `w`（高写在图形的 `h` 里）；文字给了 `w` 就按它的宽折行，没给时框宽取量出来的文字宽
 * （元素模型的文字框宽就是折行宽，高由种类推出，不再记量出来的高）。
 */
export function presetLayerBox(layer: TextPresetLayer, canvas: { width: number; height: number }, measure: MeasureText): Place {
  const { x, y, w, rot } = layer.place;
  if (layer.kind === 'shape') return placeBox({ x, y, w: w ?? 20, ...(rot === undefined ? {} : { rot }) });
  const width = w ?? (measure(layer.text ?? '', layer.style ?? {}, null).width / canvas.width) * 100;
  return placeBox({ x, y, w: width, ...(rot === undefined ? {} : { rot }) });
}

/** 一条预设 → 新建的几层（低层在前），各层按自己的 `delay` 错峰。 */
export function presetLayers(
  preset: TextPreset,
  canvas: { width: number; height: number },
  fps: Rate,
  measure: MeasureText,
): VisualLayer[] {
  return preset.layers.map((layer): VisualLayer => {
    const place = presetLayerBox(layer, canvas, measure);
    const delayFrames = Math.round(((layer.delay ?? 0) * fps.num) / fps.den);
    const timing = delayFrames > 0 ? { delayFrames } : {};
    if (layer.kind === 'shape') {
      const shape: ShapeProps = { shape: 'rect', ...layer.shape, ...(layer.h === undefined ? {} : { h: layer.h }) };
      return { type: 'shape', place, shape, ...timing };
    }
    return { type: 'text', place, text: layer.text ?? '', style: layer.style ?? {}, ...timing };
  });
}

/** 新建之后选中哪一层：第一层文字（旧版 `preferred_member`），没有文字时第一层。 */
export function preferredLayer(preset: TextPreset): number {
  return Math.max(
    0,
    preset.layers.findIndex((layer) => layer.kind === 'text'),
  );
}

/** 「添加文本框」的那一层。 */
export function blankTextLayer(canvas: { width: number; height: number }, measure: MeasureText): VisualLayer {
  const size = measure(BLANK_TEXT.text, BLANK_TEXT.style, null);
  const place = placeBox({ x: 50, y: 40, w: (size.width / canvas.width) * 100 });
  return { type: 'text', place, text: BLANK_TEXT.text, style: { ...BLANK_TEXT.style } };
}
