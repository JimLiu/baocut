import { describe, expect, it } from 'vitest';
import type { CaptionItem, Sequence, VideoItem } from '@baocut/protocol';
import { placeCues, placedCues } from './caption-cues.ts';

const fps = { num: 30, den: 1 };
const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };

function clip(id: string, fromFrame: number, durationFrames: number, sourceInFrames: number): VideoItem {
  return {
    ...base,
    id,
    trackId: 'v1',
    type: 'video',
    span: { fromFrame, durationFrames },
    place: {},
    mode: 'fullscreen',
    assetRef: { id: 'asset_main', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: String(sourceInFrames), timescale: 30 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
  };
}

function sequence(items: Sequence['items']): Sequence {
  return {
    id: 'seq',
    revision: '1',
    name: '主序列',
    fps,
    canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
    durationPolicy: { kind: 'derived' },
    tracks: [],
    items,
    animationBindings: [],
    transitions: [],
    markers: [],
    ducking: [],
  };
}

const cues = [
  { id: 'a', start: 1, end: 2, text: '一' },
  { id: 'b', start: 4, end: 6, text: '二' },
  { id: 'c', start: 11, end: 12, text: '三' },
  { id: 'd', start: 13, end: 14, text: ' ' },
];

describe('字幕句子投到时间线', () => {
  it('经作用实例的时间映射投影：剪掉的源区间不出现，跨剪切点的句子被裁开', () => {
    // 第一段取源 0–5 秒放在 0–5 秒，第二段取源 10–13 秒放在 5–8 秒。
    const first = clip('v_a', 0, 150, 0);
    const second = clip('v_b', 150, 90, 300);
    const caption: CaptionItem = {
      ...base,
      id: 'cap',
      trackId: 's1',
      type: 'caption',
      span: { fromFrame: 0, durationFrames: 240 },
      documentId: 'doc',
      scopeItemIds: ['v_a', 'v_b'],
    };
    const placed = placeCues(caption, sequence([first, second, caption]), { clock: 'source-asset', cues });
    expect(placed).toEqual([
      { key: 'v_a:a', cueId: 'a', start: 1, end: 2, text: '一' },
      { key: 'v_a:b', cueId: 'b', start: 4, end: 5, text: '二' },
      { key: 'v_b:c', cueId: 'c', start: 6, end: 7, text: '三' },
    ]);
  });

  it('序列时钟的文档直接用文档时间，裁在字幕实例的区间里', () => {
    const caption: CaptionItem = {
      ...base,
      id: 'cap',
      trackId: 's1',
      type: 'caption',
      span: { fromFrame: 45, durationFrames: 300 },
      documentId: 'doc',
    };
    const placed = placeCues(caption, sequence([caption]), { clock: 'sequence', cues });
    expect(placed.map((cue) => [cue.key, cue.start, cue.end])).toEqual([
      ['a', 1.5, 2],
      ['b', 4, 6],
      ['c', 11, 11.5],
    ]);
  });

  it('作用实例都删了时什么也不出现（不退回序列时间）；序列时钟的文档有作用实例时只在实例覆盖的区间里出现', () => {
    const caption: CaptionItem = {
      ...base,
      id: 'cap',
      trackId: 's1',
      type: 'caption',
      span: { fromFrame: 0, durationFrames: 450 },
      documentId: 'doc',
      scopeItemIds: ['gone'],
    };
    expect(placeCues(caption, sequence([caption]), { clock: 'source-asset', cues })).toEqual([]);
    // 实例占序列 3–5 秒：序列时钟的句子裁在这一段里。
    const scoped = { ...caption, scopeItemIds: ['gone', 'v_a'] };
    const placed = placeCues(scoped, sequence([clip('v_a', 90, 60, 0), scoped]), { clock: 'sequence', cues });
    expect(placed).toEqual([{ key: 'v_a:b', cueId: 'b', start: 4, end: 5, text: '二' }]);
  });

  it('作用实例重叠（链在一起的音视频）：后列出的只占没被占的区间，不出两份', () => {
    const caption: CaptionItem = {
      ...base,
      id: 'cap',
      trackId: 's1',
      type: 'caption',
      span: { fromFrame: 0, durationFrames: 450 },
      documentId: 'doc',
      scopeItemIds: ['v_a', 'v_b'],
    };
    // 两个实例都取源 0 秒起放在 0 秒；后一个更长，只多出 5–8 秒那一段。
    const placed = placeCues(caption, sequence([clip('v_a', 0, 150, 0), clip('v_b', 0, 240, 0), caption]), { clock: 'source-asset', cues });
    expect(placed.map((cue) => [cue.key, cue.start, cue.end])).toEqual([
      ['v_a:a', 1, 2],
      ['v_a:b', 4, 5],
      ['v_b:b', 5, 6],
    ]);
  });

  it('缓存版按字幕文档、序列与实例记住：同一组输入取回同一份，换了序列版本就重算', () => {
    const caption: CaptionItem = {
      ...base,
      id: 'cap',
      trackId: 's1',
      type: 'caption',
      span: { fromFrame: 45, durationFrames: 300 },
      documentId: 'doc',
    };
    const track = { clock: 'sequence' as const, cues };
    const first = sequence([caption]);
    const placed = placedCues(caption, first, track);
    expect(placed).toEqual(placeCues(caption, first, track));
    expect(placedCues(caption, first, track)).toBe(placed);
    const next = { ...first, revision: '2' };
    expect(placedCues(caption, next, track)).not.toBe(placed);
    expect(placedCues(caption, next, track)).toEqual(placed);
    expect(placedCues(caption, first, { ...track })).not.toBe(placed);
  });
});
