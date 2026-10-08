import { describe, expect, it } from 'vitest';
import type { Fx, SequenceItem } from '@baocut/protocol';
import {
  effectKindsFor,
  effectNumber,
  effectOn,
  hasKnownEffects,
  resetEffects,
  setEffectsOperation,
  toggleEffect,
  unknownKinds,
  withEffect,
} from './effects-panel.ts';

const blurred: Fx = { blur: 4 };

describe('效果', () => {
  it('四张卡只给有 fx 的片段：视觉媒体与合成；文字、图形、声音没有', () => {
    expect(effectKindsFor({ type: 'video' } as SequenceItem)).toEqual(['color-adjust', 'gaussian-blur', 'drop-shadow', 'stroke']);
    expect(effectKindsFor({ type: 'composition' } as SequenceItem)).toEqual(['color-adjust', 'gaussian-blur', 'drop-shadow', 'stroke']);
    expect(effectKindsFor({ type: 'text' } as SequenceItem)).toEqual([]);
    expect(effectKindsFor({ type: 'shape' } as SequenceItem)).toEqual([]);
    expect(effectKindsFor({ type: 'audio' } as SequenceItem)).toEqual([]);
  });

  it('改一张卡：数值合并进它管的字段；还关着就按缺省值打开，别的字段不动', () => {
    expect(withEffect(blurred, 'gaussian-blur', { radius: 9 })).toEqual({ blur: 9 });
    expect(withEffect({ grayscale: 1 }, 'drop-shadow', { opacity: 0.8 })).toEqual({
      grayscale: 1,
      shadow: { offsetX: 0, offsetY: 8, blur: 12, color: '#000000', opacity: 0.8 },
    });
    // 颜色校正：改的那项写上，其余四项按 0 补齐（卡开着就是五项都在）。
    expect(withEffect(undefined, 'color-adjust', { hue: 0.2 })).toEqual({
      brightness: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      hue: 0.2,
    });
  });

  it('开关：关上去掉它管的字段（再打开回到缺省值）；已开着的不动', () => {
    expect(toggleEffect(blurred, 'gaussian-blur', false)).toEqual({});
    expect(toggleEffect({}, 'gaussian-blur', true)).toEqual({ blur: 8 });
    expect(toggleEffect(blurred, 'gaussian-blur', true)).toEqual(blurred);
    const tinted: Fx = { hue: 0.1, blur: 2 };
    expect(effectOn(tinted, 'color-adjust')).toBe(true);
    expect(toggleEffect(tinted, 'color-adjust', false)).toEqual({ blur: 2 });
  });

  it('读数：缺的用这种效果的缺省值', () => {
    expect(effectNumber(blurred, 'gaussian-blur', 'radius')).toBe(4);
    expect(effectNumber({}, 'gaussian-blur', 'radius')).toBe(8);
    expect(effectNumber(undefined, 'color-adjust', 'brightness')).toBe(0);
    expect(effectNumber({ stroke: { width: 2, color: '#FF0000' } }, 'stroke', 'width')).toBe(2);
    expect(effectNumber(undefined, 'drop-shadow', 'offsetY')).toBe(8);
  });

  it('页上没有控件的字段原样留着：重置不动它，并列出确实生效的那几项', () => {
    const fx: Fx = { blur: 4, grayscale: 1, filterPreset: 'none', exposure: 0 };
    expect(resetEffects(fx)).toEqual({ grayscale: 1, filterPreset: 'none', exposure: 0 });
    expect(unknownKinds(fx)).toEqual(['灰度']);
    expect(hasKnownEffects({ grayscale: 1 })).toBe(false);
    expect(hasKnownEffects(fx)).toBe(true);
  });

  it('提交：整份 fx 替换；什么都没有时写 null', () => {
    expect(setEffectsOperation('seq', 'item', { blur: 3 })).toEqual({
      type: 'setEffects',
      sequenceId: 'seq',
      itemId: 'item',
      fx: { blur: 3 },
    });
    expect(setEffectsOperation('seq', 'item', {})).toEqual({ type: 'setEffects', sequenceId: 'seq', itemId: 'item', fx: null });
    expect(setEffectsOperation('seq', 'item', undefined)).toMatchObject({ fx: null });
  });
});
