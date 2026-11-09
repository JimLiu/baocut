import { describe, expect, it } from 'vitest';
// @ts-expect-error A standalone script with no types.
import { contrastWithBlack, darkEdges, styleChanges, styleOf } from '../skills/baocut/built-in-skills/production-scripts/scripts/captions.mjs';

const config = (style: Record<string, unknown>) => ({ captions: { style } });

/** The default caption style draws a black outline and a black drop shadow, which smear dark narration text into a blob. */
describe('narration caption edges', () => {
  it('measures contrast against black from #RGB, #RRGGBB and #RRGGBBAA', () => {
    expect(contrastWithBlack('#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastWithBlack('#fff')).toBeCloseTo(21, 5);
    expect(contrastWithBlack('#00000000')).toBeCloseTo(1, 5);
    expect(contrastWithBlack('#7A6754')).toBeLessThan(4.5);
    expect(contrastWithBlack('white')).toBeNull();
  });

  it('turns the default outline and shadow off for dark text on a light page', () => {
    const style = styleOf(config({ fontColor: '#7A6754', sungColor: '#2B2118' }));
    expect(style).toMatchObject({ textOutline: { on: false }, dropShadow: { on: false } });
  });

  it('also does it when only the sung colour is dark ink', () => {
    expect(darkEdges({ fontColor: '#D8D0C0', sungColor: '#24211C' })).toEqual({ textOutline: { on: false }, dropShadow: { on: false } });
  });

  it('keeps the edges a config writes out', () => {
    const outline = { on: true, color: '#FFFFFF', width: 10 };
    expect(styleOf(config({ fontColor: '#24211C', textOutline: outline }))).toEqual({
      fontColor: '#24211C',
      textOutline: outline,
      dropShadow: { on: false },
    });
  });

  it('leaves light text and colourless configs on the default edges', () => {
    expect(styleOf(config({ fontColor: '#B9B1A3', sungColor: '#F4E6C8' }))).toEqual({ fontColor: '#B9B1A3', sungColor: '#F4E6C8' });
    expect(styleOf(config({ y: 78 }))).toEqual({ y: 78 });
    expect(styleOf({})).toBeNull();
  });

  it('patches only the switch of an existing black outline, once', () => {
    const want = styleOf(config({ fontColor: '#7A6754' }));
    const cur = {
      fontColor: '#7A6754',
      textOutline: { on: true, color: '#000000', width: 14 },
      dropShadow: { on: true, color: '#000000', opacity: 0.9 },
      wordAnimation: { catalogId: 'none' },
    };
    expect(styleChanges(cur, want)).toEqual({ textOutline: { on: false }, dropShadow: { on: false } });
    const after = { ...cur, textOutline: { ...cur.textOutline, on: false }, dropShadow: { ...cur.dropShadow, on: false } };
    expect(styleChanges(after, want)).toEqual({});
  });
});
