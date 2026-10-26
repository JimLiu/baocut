import { describe, expect, it } from 'vitest';
import type { CaptionSceneStyleBody, Sequence } from '@baocut/protocol';
import {
  cleanAdjust,
  cueWords,
  dropPresentations,
  isAdjusted,
  isSceneStyle,
  normalizeColor,
  seedAfter,
  seedIndex,
  setWordTag,
  taggedWords,
  withAdjust,
  withColor,
  withFont,
  withPlacement,
  withScale,
  withSeed,
} from './caption-scene-style.ts';

const body = { schema: 'baocut.caption-scene-style/1', scene: { schema: 'baocut.caption-scene/1' } } as unknown as CaptionSceneStyleBody;

describe('caption scene style adjust', () => {
  it('recognizes scene styles only', () => {
    expect(isSceneStyle(body)).toBe(true);
    expect(isSceneStyle({ schema: 'baocut.caption-style/1', style: {} })).toBe(false);
    expect(isSceneStyle({ schema: 'baocut.caption-scene-style/1' })).toBe(false);
  });

  it('normalizes colors to uppercase #RRGGBBAA', () => {
    expect(normalizeColor('#ff0000')).toBe('#FF0000FF');
    expect(normalizeColor('#11223344')).toBe('#11223344');
    expect(normalizeColor('red')).toBeNull();
  });

  it('drops entries that change nothing', () => {
    expect(cleanAdjust({ colors: [{ from: '#FFFFFFFF', to: '#ffffff' }], fontScale: 1, placement: {} })).toBeNull();
    expect(cleanAdjust({ fonts: [{ from: 'A', to: { family: '' } }] })).toBeNull();
    expect(cleanAdjust({ fontScale: 3, placement: { x: 1.4, width: 0 } })).toEqual({ fontScale: 2, placement: { x: 1, width: 0.01 } });
  });

  it('swaps one color at a time and reverts with null', () => {
    const one = withColor(null, '#ffffffff', '#FF0000FF');
    expect(one).toEqual({ colors: [{ from: '#FFFFFFFF', to: '#FF0000FF' }] });
    const two = withColor(one, '#000000FF', '#00FF00FF');
    expect(two?.colors).toHaveLength(2);
    expect(withColor(withColor(two, '#000000FF', null), '#FFFFFFFF', null)).toBeNull();
  });

  it('swaps fonts, scale and placement, and restore removes adjust', () => {
    let adjust = withFont(null, 'Inter', { family: 'Lexend Deca' });
    adjust = withScale(adjust, 1.256);
    adjust = withPlacement(adjust, 'y', 0.7);
    expect(adjust).toEqual({ fonts: [{ from: 'Inter', to: { family: 'Lexend Deca' } }], fontScale: 1.26, placement: { y: 0.7 } });
    const adjusted = withAdjust(body, adjust);
    expect(isAdjusted(adjusted)).toBe(true);
    const restored = withAdjust(adjusted, null);
    expect('adjust' in restored).toBe(false);
    expect(isAdjusted(restored)).toBe(false);
    expect(withPlacement(withPlacement(null, 'x', 0.3), 'x', null)).toBeNull();
    expect(withFont(withFont(null, 'Inter', { family: 'X' }), 'Inter', null)).toBeNull();
  });
});

describe('caption presentation', () => {
  it('tags and untags a word, keeping other data', () => {
    const start = { parameters: { size: 2 }, wordTags: { w1: ['other'] } };
    const on = setWordTag(start, 'w1', true);
    expect(on).toEqual({ parameters: { size: 2 }, wordTags: { w1: ['other', 'keyword'] } });
    expect(taggedWords(on ?? undefined)).toEqual(new Set(['w1']));
    expect(setWordTag(on ?? undefined, 'w1', true)).toEqual(on);
    expect(setWordTag(on ?? undefined, 'w1', false)).toEqual(start);
    expect(setWordTag(undefined, 'w2', false)).toBeNull();
  });

  it('counts variants from the seed', () => {
    expect(seedIndex(undefined)).toBe(0);
    expect(seedAfter(undefined)).toBe('0000000000000001');
    const first = withSeed(undefined, seedAfter(undefined));
    expect(first).toEqual({ seed: '0000000000000001' });
    expect(seedIndex(first ?? undefined)).toBe(1);
    expect(withSeed({ wordTags: { w: ['keyword'] } }, '000000000000000a')).toEqual({ wordTags: { w: ['keyword'] }, seed: '000000000000000a' });
    expect(withSeed(undefined, '0000000000000000')).toBeNull();
  });

  it('drops presentations on items of replaced templates only', () => {
    const sequence = {
      id: 'seq',
      items: [
        { id: 'a', type: 'caption', styleDocumentId: 'tpl', presentation: { seed: '0000000000000001' } },
        { id: 'b', type: 'caption', styleDocumentId: 'tpl' },
        { id: 'c', type: 'caption', styleDocumentId: 'other', presentation: { seed: '0000000000000002' } },
        { id: 'd', type: 'video' },
      ],
    } as unknown as Sequence;
    expect(dropPresentations(sequence, new Set(['tpl']))).toEqual([
      { type: 'setCaptionPresentation', sequenceId: 'seq', itemId: 'a', presentation: null },
    ]);
    expect(dropPresentations(sequence, new Set())).toEqual([]);
  });
});

describe('cue words', () => {
  const speech = {
    schema: 'baocut.speech/1',
    words: [
      { id: 'a', text: ' Hello' },
      { id: 'b', text: ' ' },
      { id: 'c', text: 'quiet', hidden: true },
      { id: 'd', text: 'world ' },
      { id: 'e', text: 'later' },
    ],
  };
  const captions = {
    schema: 'baocut.caption/1',
    cues: [
      { id: 'c1', text: 'Hello world', words: { first: 'a', last: 'd' } },
      { id: 'c2', text: 'later', words: { wordIds: ['e', 'missing'] } },
      { text: 'no words' },
    ],
  };

  it('reads a range, skipping blank and hidden words', () => {
    expect(cueWords(captions, speech, 'c1')).toEqual([
      { id: 'a', text: 'Hello' },
      { id: 'd', text: 'world' },
    ]);
  });

  it('reads explicit ids and ignores unknown ones', () => {
    expect(cueWords(captions, speech, 'c2')).toEqual([{ id: 'e', text: 'later' }]);
  });

  it('returns null without words or a speech document', () => {
    expect(cueWords(captions, speech, 'cue-2')).toBeNull();
    expect(cueWords(captions, undefined, 'c1')).toBeNull();
    expect(cueWords(captions, speech, 'nope')).toBeNull();
  });
});
