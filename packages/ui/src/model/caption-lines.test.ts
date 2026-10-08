import { describe, expect, it } from 'vitest';
import { resolveLineStyle, type Json } from '../render/text-style.ts';
import { editLine, followRatio, followShared, lineOverrides, lineSize, lineView, withCaptionStyle } from './caption-lines.ts';

/** 渲染器在 540 短边的画布上画出来的字号 = 30 号口径的有效字号。 */
const drawn = (root: Json, kind: 'original' | 'translation', compact: boolean) =>
  resolveLineStyle(root, kind, { width: 960, height: 540 }, compact).fontSize;

describe('比例链', () => {
  it('缺省：根 30，双语原文 20，译文 32；单语原文 30', () => {
    expect(lineSize({}, 'original', true)).toMatchObject({ size: 20, root: 30, explicit: false });
    expect(lineSize({}, 'translation', true).size).toBeCloseTo(32);
    expect(lineSize({}, 'original', false).size).toBe(30);
  });

  it('与渲染器同一个算法', () => {
    const root = { fontSize: 40, bilingualOrigScale: 0.5, transScale: 1.5, origStyle: { fontSize: 22 } };
    for (const kind of ['original', 'translation'] as const)
      for (const compact of [true, false]) expect(lineSize(root, kind, compact).size).toBeCloseTo(drawn(root, kind, compact));
  });

  it('显示的那一行：覆盖叠上去，字号换成有效字号', () => {
    expect(lineView({ fontColor: '#fff', transStyle: { fontColor: '#ff0' } }, 'translation', true)).toMatchObject({ fontColor: '#ff0', fontSize: 32 });
  });
});

describe('原文 / 译文各自改', () => {
  it('译文：写进 transStyle，原文不动', () => {
    const root = { fontColor: '#FFFFFF' };
    const next = editLine(root, { fontColor: '#FFE14D' }, 'translation', true, true);
    expect(next).toEqual({ fontColor: '#FFFFFF', transStyle: { fontColor: '#FFE14D' } });
  });

  it('译文字号改的是 transScale，原文字号改根字号，画出来就是填的数', () => {
    const t = editLine({}, { fontSize: 40 }, 'translation', true, true);
    expect(t.transStyle).toEqual({});
    expect(drawn(t, 'translation', true)).toBeCloseTo(40);
    expect(drawn(t, 'original', true)).toBeCloseTo(20);
    const o = editLine({}, { fontSize: 24 }, 'original', true, true);
    expect(drawn(o, 'original', true)).toBeCloseTo(24);
    expect(drawn(o, 'translation', true)).toBeCloseTo(24 * 1.6);
  });

  it('单独设过字号的改那个单独值', () => {
    const next = editLine({ transStyle: { fontSize: 18 } }, { fontSize: 26 }, 'translation', true, true);
    expect(next.transStyle).toEqual({ fontSize: 26 });
    expect(followRatio(next, 'translation')).toEqual({});
  });

  it('只管一种行：写根样式，覆盖里同名的键去掉', () => {
    const next = editLine({ fontColor: '#fff', origStyle: { fontColor: '#f00', bold: true } }, { fontColor: '#0f0' }, 'original', false, false);
    expect(next).toEqual({ fontColor: '#0f0', origStyle: { bold: true } });
    expect(editLine({ origStyle: { fontColor: '#f00' } }, { fontColor: '#0f0', fontSize: 36 }, 'original', false, false)).toEqual({
      fontColor: '#0f0',
      fontSize: 36,
    });
    expect(drawn(editLine({}, { fontSize: 36 }, 'translation', false, false), 'translation', false)).toBeCloseTo(36);
  });

  it('全部跟随、计数、整份正文', () => {
    const root = { y: 80, transStyle: { fontColor: '#ff0', bgOn: null } };
    expect(lineOverrides(root, 'translation')).toBe(2);
    expect(lineOverrides(root, 'original')).toBe(0);
    expect(followShared(root, 'translation')).toEqual({ y: 80 });
    expect(withCaptionStyle({ schema: 'x', style: { a: 1 }, extra: 2 }, { b: 1 })).toEqual({
      schema: 'baocut.legacy-studio-style/0.1',
      style: { b: 1 },
      extra: 2,
    });
  });
});
