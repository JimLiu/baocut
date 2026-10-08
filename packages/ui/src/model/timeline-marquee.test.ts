import { describe, expect, it } from 'vitest';
import type { AudioItem, CaptionItem, Sequence, Track, VideoItem } from '@baocut/protocol';
import { itemBox, marqueeItems, marqueeSelection, type MarqueeLayout } from './timeline-marquee.ts';

const fps = { num: 30, den: 1 };

function track(id: string, order: number, kind: Track['kind'], locked = false): Track {
  return { id, order, kind, locked, visible: true, muted: false, solo: { enabled: false, group: kind === 'audio' ? 'audio' : 'visual' } };
}

function video(id: string, trackId: string, fromFrame: number, durationFrames: number, locked = false): VideoItem {
  return {
    id,
    trackId,
    type: 'video',
    enabled: true,
    locked,
    paintOrder: 0,
    followPolicy: { kind: 'sequence-fixed' },
    span: { fromFrame, durationFrames },
    place: {},
    mode: 'fullscreen',
    assetRef: { id: 'asset_v', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 30 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
  };
}

/** 音频按秒放（起点可以落在帧之间）。 */
function audio(id: string, trackId: string, startSeconds: number, seconds: number): AudioItem {
  const fromFrame = Math.floor(startSeconds * 30);
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
    subframeOffset: { ticks: String(Math.round((startSeconds - fromFrame / 30) * 1000)), timescale: 1000 },
    playDuration: { ticks: String(Math.round(seconds * 1000)), timescale: 1000 },
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
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

// 行头 144、左边留白 12、每秒 10 像素；刻度尺 24 高，视觉行 64、音频行 48。
const layout: MarqueeLayout = {
  head: 144,
  pad: 12,
  pxPerSecond: 10,
  lanes: [
    { trackId: 'v1', top: 24, height: 64 },
    { trackId: 'a1', top: 88, height: 48 },
    { trackId: 'a2', top: 136, height: 48 },
  ],
};

const seq = sequence(
  [track('v1', 0, 'visual'), track('a1', 0, 'audio'), track('a2', 1, 'audio', true)],
  [video('clip1', 'v1', 0, 300), video('clip2', 'v1', 300, 150), audio('voice', 'a1', 2.5, 4), audio('music', 'a2', 0, 20)],
);

describe('时间线框选', () => {
  it('实例的盒：时段 × 整行，按秒换成内容坐标（音频起点可以在帧之间）', () => {
    expect(itemBox(seq, 'clip2', layout)).toEqual({ x: 144 + 12 + 100, y: 24, w: 50, h: 64 });
    const voice = itemBox(seq, 'voice', layout)!;
    expect(voice.x).toBeCloseTo(144 + 12 + 25);
    expect(voice.w).toBeCloseTo(40);
    expect(voice.y).toBe(88);
    expect(itemBox(seq, 'missing', layout)).toBeNull();
  });

  it('跨轨道全选框到的，锁着的轨道上的不选', () => {
    // 横跨 8–12 秒、竖跨视觉行与两条音频行
    const rect = { x: 156 + 80, y: 30, w: 40, h: 140 };
    expect(marqueeItems(seq, layout, rect)).toEqual(['clip1', 'clip2']);
    // 只框到配音那一行的 3–4 秒
    expect(marqueeItems(seq, layout, { x: 156 + 30, y: 100, w: 10, h: 10 })).toEqual(['voice']);
  });

  it('贴边不算；锁着的实例不选', () => {
    // 右边正好贴着 clip2 的左缘（10 秒）
    expect(marqueeItems(seq, layout, { x: 156 + 95, y: 30, w: 5, h: 10 })).toEqual(['clip1']);
    const locked = sequence(seq.tracks, [video('clip1', 'v1', 0, 300, true), video('clip2', 'v1', 300, 150)]);
    expect(marqueeItems(locked, layout, { x: 156, y: 30, w: 200, h: 10 })).toEqual(['clip2']);
  });

  it('字幕实例不选：框过字幕行只选到别的轨上的片段', () => {
    const caption: CaptionItem = {
      id: 'cap',
      trackId: 's1',
      type: 'caption',
      enabled: true,
      locked: false,
      paintOrder: 0,
      followPolicy: { kind: 'sequence-fixed' },
      span: { fromFrame: 0, durationFrames: 450 },
      documentId: 'doc',
      scopeItemIds: ['clip1', 'clip2'],
    };
    const withCaption = sequence([track('s1', 1, 'subtitle'), ...seq.tracks], [...seq.items, caption]);
    const lanes = [{ trackId: 's1', top: 24, height: 40 }, ...layout.lanes.map((lane) => ({ ...lane, top: lane.top + 40 }))];
    expect(marqueeItems(withCaption, { ...layout, lanes }, { x: 156, y: 30, w: 40, h: 60 })).toEqual(['clip1']);
    expect(marqueeItems(withCaption, { ...layout, lanes }, { x: 156, y: 30, w: 40, h: 10 })).toEqual([]);
  });

  it('矩形可以从右下往左上拉', () => {
    expect(marqueeItems(seq, layout, { x: 156 + 120, y: 110, w: -40, h: -90 })).toEqual(['clip1', 'clip2']);
  });

  it('换了缩放与滚动：内容坐标跟着缩放，矩形照样命中', () => {
    const zoomed = { ...layout, pxPerSecond: 40 };
    // 同一个矩形：10 px/s 下是 30–35 秒，什么都没有；40 px/s 下是 7.5–8.75 秒，落在 clip1 上
    const rect = { x: 156 + 300, y: 30, w: 50, h: 100 };
    expect(marqueeItems(seq, layout, rect)).toEqual([]);
    expect(marqueeItems(seq, zoomed, rect)).toEqual(['clip1']);
    // 40 px/s 下 clip2 在 400–600，voice 在 100–260
    expect(marqueeItems(seq, zoomed, { x: 156 + 420, y: 30, w: 10, h: 10 })).toEqual(['clip2']);
    expect(marqueeItems(seq, zoomed, { x: 156 + 250, y: 90, w: 20, h: 10 })).toEqual(['voice']);
  });

  it('⇧ / ⌘ 并入原选区（去重），否则换成框到的', () => {
    expect(marqueeSelection(['a', 'b'], ['b', 'c'], true)).toEqual(['a', 'b', 'c']);
    expect(marqueeSelection(['a', 'b'], ['b', 'c'], false)).toEqual(['b', 'c']);
    expect(marqueeSelection(['a'], [], false)).toEqual([]);
  });
});
