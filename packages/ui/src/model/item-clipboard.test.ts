import { describe, expect, it } from 'vitest';
import type { AudioItem, CaptionItem, Place, Sequence, ShapeItem, TextItem, Track, VideoItem } from '@baocut/protocol';
import { copyName, pasteOperations, pastePlace, pasteStart } from './item-clipboard.ts';

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

function shape(id: string, trackId: string, fromFrame: number, durationFrames: number, extra: Partial<ShapeItem> = {}): ShapeItem {
  return {
    id,
    trackId,
    type: 'shape',
    enabled: true,
    locked: false,
    paintOrder: 3,
    followPolicy: { kind: 'sequence-fixed' },
    span: { fromFrame, durationFrames },
    place: { x: 50, y: 50, w: 10 },
    shape: { shape: 'rect' },
    ...extra,
  };
}

function audio(id: string, trackId: string, fromFrame: number, seconds: number, subTicks = '0'): AudioItem {
  return {
    id,
    trackId,
    type: 'audio',
    enabled: true,
    locked: false,
    paintOrder: 0,
    followPolicy: { kind: 'sequence-fixed' },
    assetRef: { id: 'asset_a', revision: '1' },
    fromFrame,
    subframeOffset: { ticks: subTicks, timescale: 48000 },
    playDuration: { ticks: String(seconds * 48000), timescale: 48000 },
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 48000 }, rate: { num: 1, den: 1 } },
    mix: { volume: 1 },
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

const labelOf = () => '图形';

describe('粘贴的时间', () => {
  it('播放头在源片段里（两端都算）就原地；在外面就搬到播放头，保长并夹在片长里', () => {
    expect(pasteStart({ start: 30, end: 90 }, 30, 300)).toBe(30);
    expect(pasteStart({ start: 30, end: 90 }, 90, 300)).toBe(30);
    expect(pasteStart({ start: 30, end: 90 }, 150, 300)).toBe(150);
    expect(pasteStart({ start: 30, end: 90 }, 280, 300)).toBe(240);
    // 片子比片段还短：起点落在 0。
    expect(pasteStart({ start: 30, end: 90 }, 200, 40)).toBe(0);
  });
});

describe('粘贴的位置', () => {
  const canvas = { width: 1920, height: 1080 };
  const at = (place: Place) => shape('a', 'v1', 0, 30, { place });

  it('中心往右下错开 2% × 第几次，夹在限位里；大小与角度不变', () => {
    expect(pastePlace(at({ x: 50, y: 50, w: 10, rot: 15 }), canvas, 1)).toEqual({ x: 52, y: 52, w: 10, rot: 15 });
    expect(pastePlace(at({ x: 50, y: 50, w: 10 }), canvas, 3)).toEqual({ x: 56, y: 56, w: 10 });
    // 已经在右下角附近：只推到 97% / 96%。
    expect(pastePlace(at({ x: 96, y: 95, w: 10 }), canvas, 2)).toEqual({ x: 97, y: 96, w: 10 });
    // 没写位置的按画面中央算，错开后写明。
    expect(pastePlace(at({ w: 10 }), canvas, 1)).toEqual({ x: 52, y: 52, w: 10 });
  });

  it('原本在限位外的那一轴不动；铺满画布的原样不动', () => {
    expect(pastePlace(at({ x: 50, y: 111, w: 10 }), canvas, 1)).toEqual({ x: 52, y: 111, w: 10 });
    const full = { ...shape('v', 'v1', 0, 30), type: 'video', mode: 'fullscreen', place: {} } as unknown as VideoItem;
    expect(pastePlace(full, canvas, 1)).toBe(full.place);
  });

  it('名字加「· 副本」，不叠两次', () => {
    expect(copyName('标题')).toBe('标题 · 副本');
    expect(copyName('标题 · 副本')).toBe('标题 · 副本');
  });
});

describe('粘贴', () => {
  it('源轨道空着就放回原轨；去掉引擎管的字段；整批一笔', () => {
    const seq = sequence([track('v1', 0, 'visual')], []);
    const source = shape('a', 'v1', 30, 60, { name: '方块', linkGroupId: 'g1' });
    const plan = pasteOperations(seq, [source], { playheadFrame: 45, generation: 1, labelOf });
    expect(plan.count).toBe(1);
    expect(plan.operations).toHaveLength(1);
    const insert = plan.operations[0]!;
    expect(insert.type).toBe('insertItems');
    const item = insert.type === 'insertItems' ? insert.items[0]! : null;
    expect(item).toMatchObject({ type: 'shape', trackId: 'v1', name: '方块 · 副本', span: { fromFrame: 30, durationFrames: 60 } });
    for (const key of ['id', 'lineage', 'enabled', 'locked', 'paintOrder', 'followPolicy', 'linkGroupId']) expect(item).not.toHaveProperty(key);
  });

  it('原轨在落点被占：放到上面第一条空着的同类轨道；没有就新建一条，后面的副本也能放进去', () => {
    const tracks = [track('v1', 0, 'visual'), track('a1', 1, 'audio'), track('v2', 2, 'visual'), track('v3', 3, 'visual', { locked: true })];
    const a = shape('a', 'v1', 0, 60);
    const seq = sequence(tracks, [a, shape('b', 'v2', 0, 30)]);
    // v2 在 [0, 60) 被占、v3 锁着：新建一条。
    const plan = pasteOperations(seq, [a], { playheadFrame: 10, generation: 1, labelOf });
    expect(plan.operations[0]).toEqual({ type: 'addTrack', sequenceId: 'seq', kind: 'visual', ref: 'paste-track-0' });
    const insert = plan.operations[1]!;
    expect(insert.type === 'insertItems' && insert.items[0]).toMatchObject({ trackRef: 'paste-track-0' });

    // 搬到播放头 [70, 130)：v1 被后面那件占着，v2 空着。
    const longer = sequence(tracks, [a, shape('x', 'v1', 60, 140), shape('b', 'v2', 0, 30)]);
    const later = pasteOperations(longer, [a], { playheadFrame: 70, generation: 1, labelOf });
    expect(later.operations).toHaveLength(1);
    const placed = later.operations[0]!;
    expect(placed.type === 'insertItems' && placed.items[0]).toMatchObject({ trackId: 'v2', span: { fromFrame: 70 } });
  });

  it('同一批里两件落在同一段：第二件不叠在第一件上', () => {
    const seq = sequence([track('v1', 0, 'visual')], []);
    const a = shape('a', 'v1', 0, 60);
    const b = shape('b', 'v1', 0, 60);
    const plan = pasteOperations(seq, [a, b], { playheadFrame: 10, generation: 1, labelOf });
    expect(plan.operations.map((op) => op.type)).toEqual(['addTrack', 'insertItems']);
    const insert = plan.operations[1]!;
    expect(insert.type === 'insertItems' && insert.items.map((item) => ('trackId' in item ? item.trackId : item.trackRef))).toEqual([
      'v1',
      'paste-track-0',
    ]);
  });

  it('文字没有自己的名字时不起名；字幕副本共用同一份文档', () => {
    const text: TextItem = { ...shape('t', 'v1', 0, 30), type: 'text', text: '你好', style: {} } as unknown as TextItem;
    const caption: CaptionItem = {
      id: 'c',
      trackId: 's1',
      type: 'caption',
      enabled: true,
      locked: false,
      paintOrder: 0,
      followPolicy: { kind: 'sequence-fixed' },
      span: { fromFrame: 0, durationFrames: 300 },
      documentId: 'doc_1',
    };
    const seq = sequence([track('v1', 0, 'visual'), track('s1', 1, 'subtitle')], [caption]);
    const plan = pasteOperations(seq, [text, caption], { playheadFrame: 10, generation: 1, labelOf: () => '字幕' });
    const insert = plan.operations.find((op) => op.type === 'insertItems')!;
    const [pastedText, pastedCaption] = insert.type === 'insertItems' ? insert.items : [];
    expect(pastedText).not.toHaveProperty('name');
    expect(pastedCaption).toMatchObject({ type: 'caption', documentId: 'doc_1', name: '字幕 · 副本' });
    expect(plan.operations[0]).toMatchObject({ type: 'addTrack', kind: 'subtitle' });
  });

  it('音频：原地保留帧内偏移，搬到播放头时落在帧上', () => {
    const a = audio('a', 'a1', 30, 2, '800');
    const seq = sequence([track('a1', 0, 'audio'), track('a2', 1, 'audio')], [a]);
    const here = pasteOperations(seq, [a], { playheadFrame: 40, generation: 1, labelOf: () => '配乐' });
    const inPlace = here.operations[0]!;
    expect(inPlace.type === 'insertItems' && inPlace.items[0]).toMatchObject({
      trackId: 'a2',
      fromFrame: 30,
      subframeOffset: { ticks: '800', timescale: 48000 },
    });
    expect(inPlace.type === 'insertItems' && inPlace.items[0]).not.toHaveProperty('place');
    const there = pasteOperations(sequence(seq.tracks, [a, { ...a, id: 'z', fromFrame: 200 }]), [a], {
      playheadFrame: 120,
      generation: 1,
      labelOf: () => '配乐',
    });
    const moved = there.operations[0]!;
    expect(moved.type === 'insertItems' && moved.items[0]).toMatchObject({
      trackId: 'a1',
      fromFrame: 120,
      subframeOffset: { ticks: '0', timescale: 48000 },
    });
  });
});
