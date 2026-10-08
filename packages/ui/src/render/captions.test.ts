import { describe, expect, it } from 'vitest';
import { readCaptions } from './captions.ts';
import { parseColor, resolveLineStyle } from './text-style.ts';

const caption = (cues: { start: number; end: number; text: string }[], clock = 'source-asset') => ({
  schema: 'baocut.caption/1',
  clock,
  timescale: 1_000_000,
  cues: cues.map((cue, i) => ({ id: `c${i}`, start: cue.start * 1_000_000, end: cue.end * 1_000_000, text: cue.text })),
});

describe('字幕文档', () => {
  it('时间按 timescale 折成秒；不认识的 schema 返回 null', () => {
    const track = readCaptions(caption([{ start: 1.5, end: 2, text: '你好' }], 'sequence'))!;
    expect(track.clock).toBe('sequence');
    expect(track.cues[0]).toMatchObject({ start: 1.5, end: 2, text: '你好' });
    expect(readCaptions({ schema: 'other/1', cues: [] })).toBeNull();
    expect(readCaptions(null)).toBeNull();
  });
});

describe('旧样式的行样式', () => {
  const canvas = { width: 1920, height: 1080 };

  it('字号以 540 短边为基准；双语时原文按 bilingualOrigScale 缩小，译文再乘 transScale', () => {
    const root = { fontSize: 30, bilingualOrigScale: 0.6, transScale: 1.5 };
    expect(resolveLineStyle(root, 'original', canvas).fontSize).toBe(60);
    expect(resolveLineStyle(root, 'original', canvas, true).fontSize).toBeCloseTo(36);
    expect(resolveLineStyle(root, 'translation', canvas, true).fontSize).toBeCloseTo(54);
    expect(resolveLineStyle({ ...root, transStyle: { fontSize: 20 } }, 'translation', canvas).fontSize).toBe(40);
  });

  it('描边宽是字号百分比的一半；旧的 outline 开关缺省 14%', () => {
    const style = resolveLineStyle({ fontSize: 30, outline: true }, 'original', canvas);
    expect(style.outline?.width).toBeCloseTo((14 * 60) / 100 / 2);
    expect(resolveLineStyle({ fontSize: 30, textOutline: { width: 14, on: false } }, 'original', canvas).outline).toBeNull();
  });

  it('底板：显式开关优先；没有开关时看背景色透明不透明', () => {
    expect(resolveLineStyle({ background: false, backgroundColor: '#000000B3' }, 'original', canvas).plate).toBeNull();
    expect(resolveLineStyle({ backgroundColor: '#053aedff' }, 'original', canvas).plate).not.toBeNull();
    expect(resolveLineStyle({ backgroundColor: '#00000000' }, 'original', canvas).plate).toBeNull();
    const block = resolveLineStyle({ background: true, backgroundStyle: 'block' }, 'original', canvas).plate!;
    expect(block.minWidth).toBeCloseTo(1920 * 0.28);
  });

  it('阴影按角度与距离折成偏移', () => {
    const effect = resolveLineStyle(
      { fontSize: 30, dropShadow: { on: true, distance: 0.1, rotation: 90, opacity: 0.5 } },
      'original',
      canvas,
    ).effect!;
    expect(effect.x).toBeCloseTo(0);
    expect(effect.y).toBeCloseTo(6);
    expect(effect.color).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('颜色认 #rgba、#rrggbbaa 与 rgba()', () => {
    expect(parseColor('#000000B3')).toEqual({ r: 0, g: 0, b: 0, a: 0xb3 / 255 });
    expect(parseColor('rgba(10,10,12,0.62)')).toEqual({ r: 10, g: 10, b: 12, a: 0.62 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('nope')).toBeNull();
  });
});
