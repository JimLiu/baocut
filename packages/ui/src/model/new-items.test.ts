import { describe, expect, it } from 'vitest';
import type { Sequence, ShapeItem, Track } from '@baocut/protocol';
import { createdItemIds, insertVisual, placeBox, spanAtPlayhead, visualSlots, wholeFilmSpan, type VisualLayer } from './new-items.ts';

const fps = { num: 30, den: 1 };

function track(id: string, order: number, kind: Track['kind'], extra: Partial<Track> = {}): Track {
  return {
    id,
    order,
    kind,
    locked: false,
    visible: true,
    muted: false,
    solo: { enabled: false, group: kind === 'audio' ? 'audio' : 'visual' },
    ...extra,
  };
}

function shape(id: string, trackId: string, fromFrame: number, durationFrames: number): ShapeItem {
  return {
    id,
    trackId,
    type: 'shape',
    enabled: true,
    locked: false,
    paintOrder: 0,
    followPolicy: { kind: 'sequence-fixed' },
    span: { fromFrame, durationFrames },
    place: {},
    shape: { shape: 'rect' },
  };
}

function sequence(tracks: Track[], items: Sequence['items']): Sequence {
  return {
    id: 'seq',
    revision: '1',
    name: '主序列',
    fps,
    canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
    durationPolicy: { kind: 'derived' },
    tracks,
    items,
    animationBindings: [],
    transitions: [],
    markers: [],
    ducking: [],
  };
}

const layer: VisualLayer = {
  type: 'shape',
  place: placeBox({ x: 50, y: 50, w: 15 }),
  shape: { shape: 'rect' },
};

describe('新建的时间', () => {
  const film = sequence([track('v1', 0, 'visual')], [shape('a', 'v1', 0, 300)]);

  it('从播放头起，截到片尾', () => {
    expect(spanAtPlayhead(film, 60, 8)).toEqual({ fromFrame: 60, durationFrames: 240 });
    expect(spanAtPlayhead(film, 200, 8)).toEqual({ fromFrame: 200, durationFrames: 100 });
  });

  it('播放头在片尾或更后面时起点不前移，至少留 0.1 秒', () => {
    expect(spanAtPlayhead(film, 300, 8)).toEqual({ fromFrame: 300, durationFrames: 3 });
    expect(spanAtPlayhead(film, 420, 8)).toEqual({ fromFrame: 420, durationFrames: 3 });
  });

  it('空片子整段落下', () => {
    expect(spanAtPlayhead(sequence([], []), 30, 8)).toEqual({ fromFrame: 30, durationFrames: 240 });
  });

  it('整部片子：从头到尾；空片子从播放头起 10 秒', () => {
    expect(wholeFilmSpan(film, 90)).toEqual({ fromFrame: 0, durationFrames: 300 });
    expect(wholeFilmSpan(sequence([], []), 90)).toEqual({ fromFrame: 90, durationFrames: 300 });
  });
});

describe('新建放哪条轨道', () => {
  it('压在这段时间里有东西的最上面那条之上；锁住、隐藏的跳过', () => {
    const tracks = [
      track('v0', 0, 'visual'),
      track('v1', 1, 'visual'),
      track('v2', 2, 'visual', { locked: true }),
      track('v3', 3, 'visual', { visible: false }),
      track('v4', 4, 'visual'),
      track('s', 5, 'subtitle'),
    ];
    const seq = sequence(tracks, [shape('a', 'v1', 0, 90)]);
    expect(visualSlots(seq, { fromFrame: 30, durationFrames: 30 }, 1)).toEqual({ slots: [{ trackId: 'v4' }], operations: [] });
    // 时间没有重叠的话下面那几条也能用。
    expect(visualSlots(seq, { fromFrame: 90, durationFrames: 30 }, 2).slots).toEqual([{ trackId: 'v0' }, { trackId: 'v1' }]);
  });

  it('不够就在最上面新建，同一笔事务里用 ref 引用', () => {
    const seq = sequence([track('v0', 0, 'visual')], [shape('a', 'v0', 0, 90)]);
    expect(visualSlots(seq, { fromFrame: 0, durationFrames: 30 }, 2, '文字')).toEqual({
      slots: [{ trackRef: 'new-track-0' }, { trackRef: 'new-track-1' }],
      operations: [
        { type: 'addTrack', sequenceId: 'seq', kind: 'visual', ref: 'new-track-0', name: '文字' },
        { type: 'addTrack', sequenceId: 'seq', kind: 'visual', ref: 'new-track-1', name: '文字' },
      ],
    });
  });
});

describe('新建的操作', () => {
  it('新建一层的 place：中心总写明，取一位小数；宽给了才写，不转不写角度', () => {
    expect(placeBox({ x: 50, y: 85, w: 100 })).toEqual({ x: 50, y: 85, w: 100 });
    expect(placeBox({ x: 25.04, y: 50, w: 15.06, rot: -4 })).toEqual({ x: 25, y: 50, w: 15.1, rot: -4 });
    expect(placeBox({ x: 50, y: 50, rot: 0 })).toEqual({ x: 50, y: 50 });
  });

  it('各层错峰出现、一起结束，最晚的也留 0.1 秒', () => {
    const seq = sequence([track('v0', 0, 'visual')], []);
    const operations = insertVisual(seq, { fromFrame: 30, durationFrames: 60 }, [
      layer,
      { ...layer, delayFrames: 15 },
      { ...layer, delayFrames: 600 },
    ]);
    expect(operations).toHaveLength(3);
    expect(operations[2]).toMatchObject({
      type: 'insertItems',
      items: [
        { trackId: 'v0', span: { fromFrame: 30, durationFrames: 60 } },
        { trackRef: 'new-track-1', span: { fromFrame: 45, durationFrames: 45 } },
        { trackRef: 'new-track-2', span: { fromFrame: 87, durationFrames: 3 } },
      ],
    });
    expect(JSON.stringify(operations)).not.toContain('delayFrames');
  });

  it('回执里只取新建的片段', () => {
    const seq = sequence([track('v0', 0, 'visual')], [shape('b', 'v0', 0, 30), shape('a', 'v0', 30, 30)]);
    expect(createdItemIds(['trk_new', 'b', 'doc', 'a'], seq)).toEqual(['b', 'a']);
  });
});
