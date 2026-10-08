import { describe, expect, it } from 'vitest';
import type { AudioItem, ImageItem, Sequence, TextItem } from '@baocut/protocol';
import { applyDraft, applyDrafts, mergeDraft, patchItem, type ItemDraft } from './item-draft.ts';

const text: TextItem = {
  id: 'text_1',
  trackId: 'track_v',
  type: 'text',
  enabled: true,
  locked: false,
  paintOrder: 0,
  followPolicy: { kind: 'sequence-fixed' },
  span: { fromFrame: 0, durationFrames: 30 },
  place: { x: 50, y: 50, w: 20 },
  text: '你好',
  style: { fontSize: 30 },
};

const image: ImageItem = {
  id: 'image_1',
  trackId: 'track_v',
  type: 'image',
  enabled: true,
  locked: false,
  paintOrder: 1,
  followPolicy: { kind: 'sequence-fixed' },
  span: { fromFrame: 0, durationFrames: 30 },
  place: {},
  assetRef: { id: 'asset_i', revision: '1' },
};

const audio: AudioItem = {
  id: 'audio_1',
  trackId: 'track_a',
  type: 'audio',
  enabled: true,
  locked: false,
  paintOrder: 0,
  followPolicy: { kind: 'sequence-fixed' },
  assetRef: { id: 'asset_a', revision: '1' },
  fromFrame: 0,
  subframeOffset: { ticks: '0', timescale: 48000 },
  playDuration: { ticks: '48000', timescale: 48000 },
  timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 48000 }, rate: { num: 1, den: 1 } },
  mix: { volume: 1 },
};

const sequence = { id: 'seq', revision: '7', items: [text, audio] } as unknown as Sequence;

describe('属性草稿', () => {
  it('叠在同一版本的序列上，只换草稿里的片段', () => {
    const draft: ItemDraft = { itemId: 'text_1', revision: '7', patch: { place: { x: 60, opacity: 0.5 } } };
    const next = applyDraft(sequence, draft);
    expect(next.items[0]).toMatchObject({ place: { x: 60, y: 50, w: 20, opacity: 0.5 } });
    expect(next.items[1]).toBe(audio);
    expect(sequence.items[0]).toBe(text);
  });

  it('序列换了版本，草稿作废', () => {
    expect(applyDraft(sequence, { itemId: 'text_1', revision: '6', patch: { place: { opacity: 0 } } })).toBe(sequence);
    expect(applyDraft(sequence, null)).toBe(sequence);
  });

  it('只叠这种片段有的字段', () => {
    expect(patchItem(audio, { mix: { volume: 0.5 }, place: { opacity: 0.2 } })).toEqual({ ...audio, mix: { volume: 0.5 } });
    expect(patchItem(text, { style: { bold: true }, shape: { shape: 'rect' } })).toEqual({ ...text, style: { bold: true } });
  });

  it('画面效果整体替换，null 去掉（有 fx 的片段才叠）', () => {
    const fx = { blur: 3 };
    expect(patchItem({ ...image, fx: { brightness: 0.2 } }, { fx })).toEqual({ ...image, fx });
    expect(patchItem({ ...image, fx: { brightness: 0.2 } }, { fx: null })).toEqual(image);
    expect(patchItem(text, { fx })).toBe(text);
    expect(patchItem(audio, { fx })).toBe(audio);
  });

  it('同一片段同一版本的草稿叠在一起，换了片段就重来', () => {
    const a: ItemDraft = { itemId: 'text_1', revision: '7', patch: { place: { x: 10, opacity: 0.5 } } };
    const b: ItemDraft = { itemId: 'text_1', revision: '7', patch: { place: { y: 20 } } };
    expect(mergeDraft(a, b).patch).toEqual({ place: { x: 10, y: 20, opacity: 0.5 } });
    const c: ItemDraft = { itemId: 'audio_1', revision: '7', patch: { mix: { volume: 2 } } };
    expect(mergeDraft(a, c)).toBe(c);
  });

  it('几份草稿逐份叠上（舞台整体拖动），过期的那份跳过', () => {
    const second = { ...text, id: 'text_2' };
    const seq = { ...sequence, items: [text, second, audio] } as Sequence;
    const shown = applyDrafts(seq, [
      { itemId: 'text_1', revision: '7', patch: { place: { x: 10 } } },
      { itemId: 'text_2', revision: '7', patch: { place: { y: 20 } } },
      { itemId: 'audio_1', revision: '6', patch: { mix: { volume: 2 } } },
    ]);
    expect(shown.items[0]).toMatchObject({ place: { x: 10, y: 50 } });
    expect(shown.items[1]).toMatchObject({ place: { x: 50, y: 20 } });
    expect(shown.items[2]).toBe(audio);
    expect(applyDrafts(seq, [])).toBe(seq);
  });
});
