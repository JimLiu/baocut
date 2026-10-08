import { describe, expect, it } from 'vitest';
import { TEXT_PRESETS, blankTextLayer, preferredLayer, presetLayers, presetsOf, type MeasureText } from './text-presets.ts';

const canvas = { width: 1920, height: 1080 };
const fps = { num: 30, den: 1 };
/** 量字的替身：一个字 10 像素宽，一行 30 像素高；给了折行宽就按它折。 */
const measure: MeasureText = (text, _style, wrap) => {
  const width = Math.max(...text.split('\n').map((line) => line.length * 10));
  const lines = text.split('\n').reduce((n, line) => n + (wrap ? Math.max(1, Math.ceil((line.length * 10) / wrap)) : 1), 0);
  return { width: wrap ?? width, height: lines * 30 };
};
const byId = (id: string) => TEXT_PRESETS.find((preset) => preset.id === id)!;

describe('文字预设', () => {
  it('51 条：简单 13、标题 10、下三分 20、其它 8，文字样式与图形都不带 schema', () => {
    expect(TEXT_PRESETS).toHaveLength(51);
    expect(['simple', 'title', 'lower', 'other'].map((c) => presetsOf(c as 'simple').length)).toEqual([13, 10, 20, 8]);
    for (const preset of TEXT_PRESETS) {
      for (const layer of preset.layers) {
        if (layer.kind === 'text') expect(layer.style?.schema).toBeUndefined();
        else expect(layer.shape ?? {}).not.toHaveProperty('schema');
      }
    }
  });

  it('文字没给宽时按量出来的宽落框（画幅宽的百分比），中心在画幅百分比处', () => {
    const [layer] = presetLayers(byId('simple.02'), canvas, fps, measure);
    // 两个字 20 像素宽：1920 的 1.04%，取一位小数。
    expect(layer).toMatchObject({ type: 'text', text: '简约', place: { x: 50, y: 50, w: 1 } });
  });

  it('多层：形状按 w、高写进 shape.h，给了宽的文字按它落框，成员按 delay 错峰', () => {
    const preset = byId('lowerThird.01');
    const layers = presetLayers(preset, canvas, fps, measure);
    expect(layers.map((layer) => layer.type)).toEqual(preset.layers.map((layer) => layer.kind));
    const shape = layers[0]!;
    if (shape.type !== 'shape') throw new Error('第一层应是图形');
    expect(shape.place.w).toBe(33.2);
    expect(shape.shape.h).toBeCloseTo(14.92);
    const delayed = preset.layers.findIndex((layer) => layer.delay);
    if (delayed >= 0) expect(layers[delayed]!.delayFrames).toBe(Math.round(preset.layers[delayed]!.delay! * 30));
    const wide = preset.layers.findIndex((layer) => layer.kind === 'text' && layer.place.w !== undefined);
    expect(layers[wide]!.place.w).toBeCloseTo(preset.layers[wide]!.place.w!, 1);
    expect(preferredLayer(preset)).toBe(preset.layers.findIndex((layer) => layer.kind === 'text'));
  });

  it('旋转的那一条带上角度', () => {
    const preset = TEXT_PRESETS.find((p) => p.layers.some((layer) => layer.place.rot))!;
    const index = preset.layers.findIndex((layer) => layer.place.rot);
    expect(presetLayers(preset, canvas, fps, measure)[index]!.place.rot).toBe(preset.layers[index]!.place.rot);
  });

  it('添加文本框：画面中线偏上，按字量框', () => {
    expect(blankTextLayer(canvas, measure)).toMatchObject({
      type: 'text',
      text: '输入文字',
      // 四个字 40 像素宽：1920 的 2.08%。
      place: { x: 50, y: 40, w: 2.1 },
    });
  });
});
