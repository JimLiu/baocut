import type { CaptionItem, Sequence, VideoItem } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import {
  LIVE_CAPTION_DOCUMENT_ID,
  LIVE_CAPTION_ITEM_ID,
  LIVE_CAPTION_STYLE_ID,
  LIVE_CAPTION_TRACK_ID,
  liveCaptionCues,
  liveCaptionDocuments,
  liveCueAt,
  withLiveCaption,
} from './live-caption.ts';
import { placeSegments } from './live-transcript.ts';
import { DEFAULT_CAPTION_STYLE } from './property-values.ts';

const fps = { num: 30, den: 1 };
const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };

function video(id: string, fromFrame: number, durationFrames: number, sourceIn: number): VideoItem {
  return {
    ...base,
    id,
    trackId: 'v1',
    type: 'video',
    span: { fromFrame, durationFrames },
    place: {},
    mode: 'fullscreen',
    assetRef: { id: 'a1', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: String(Math.round(sourceIn * 1000)), timescale: 1000 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
  };
}

function sequence(items: Sequence['items']): Sequence {
  return {
    id: 'seq',
    revision: '7',
    name: '主序列',
    fps,
    canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
    durationPolicy: { kind: 'derived' },
    tracks: [{ id: 'v1', order: 0, kind: 'visual', locked: false, visible: true, muted: false, solo: { enabled: false, group: 'visual' } }],
    items,
    animationBindings: [],
    transitions: [],
    markers: [],
    ducking: [],
  };
}

describe('liveCaptionCues', () => {
  it('投到序列上的段落按时间排好，去掉空白与零长的块', () => {
    const cues = liveCaptionCues([
      { key: 'b', start: 6, end: 9, text: ' 第二段 ' },
      { key: 'a', start: 0, end: 4, text: '第一段' },
      { key: 'blank', start: 4, end: 5, text: '  ' },
      { key: 'zero', start: 9, end: 9, text: '零长' },
    ]);
    expect(cues).toEqual([
      { key: 'a', start: 0, end: 4, text: '第一段' },
      { key: 'b', start: 6, end: 9, text: '第二段' },
    ]);
  });

  it('剪掉的部分没有字幕、错开的实例按时间线时间放（与时间线临时行同一套投影）', () => {
    // 素材 0–10 秒放在序列 0–5 秒（取素材 0–5），素材 20–30 秒放在序列 5–15 秒。
    const seq = sequence([video('i1', 0, 150, 0), video('i2', 150, 300, 20)]);
    const placed = placeSegments(seq, 'a1', [
      { start: 1, end: 3, text: '开场' },
      { start: 12, end: 14, text: '剪掉的' },
      { start: 21, end: 24, text: '后半' },
    ]);
    expect(liveCaptionCues(placed).map((c) => [c.start, c.end, c.text])).toEqual([
      [1, 3, '开场'],
      [6, 9, '后半'],
    ]);
  });
});

describe('liveCueAt', () => {
  const cues = liveCaptionCues([
    { key: 'a', start: 0, end: 4, text: '第一段' },
    { key: 'b', start: 6, end: 9, text: '第二段' },
  ]);

  it('播放头落在已识别的段落里就是这一段（左闭右开）', () => {
    expect(liveCueAt(cues, 0)?.text).toBe('第一段');
    expect(liveCueAt(cues, 3.99)?.text).toBe('第一段');
    expect(liveCueAt(cues, 6)?.text).toBe('第二段');
  });

  it('段落之间与还没转录到的部分没有字幕', () => {
    expect(liveCueAt(cues, 4)).toBeNull();
    expect(liveCueAt(cues, 5)).toBeNull();
    expect(liveCueAt(cues, 9)).toBeNull();
    expect(liveCueAt(cues, 120)).toBeNull();
    expect(liveCueAt([], 1)).toBeNull();
  });
});

describe('withLiveCaption', () => {
  it('最上面加一条锁住的字幕轨与铺满现有时长的一层字幕，序列 ID、版本与时长不变', () => {
    const seq = sequence([video('i1', 0, 300, 0)]);
    const out = withLiveCaption(seq);
    expect(out.id).toBe('seq');
    expect(out.revision).toBe('7');
    expect(out.items.slice(0, -1)).toEqual(seq.items);
    expect(out.tracks.at(-1)).toMatchObject({ id: LIVE_CAPTION_TRACK_ID, kind: 'subtitle', order: 1, visible: true });
    const item = out.items.at(-1) as CaptionItem;
    expect(item).toMatchObject({
      id: LIVE_CAPTION_ITEM_ID,
      type: 'caption',
      trackId: LIVE_CAPTION_TRACK_ID,
      span: { fromFrame: 0, durationFrames: 300 },
      documentId: LIVE_CAPTION_DOCUMENT_ID,
      styleDocumentId: LIVE_CAPTION_STYLE_ID,
      scopeItemIds: [],
      paintOrder: 1,
    });
    // 原序列不动。
    expect(seq.items).toHaveLength(1);
    expect(seq.tracks).toHaveLength(1);
  });

  it('空序列不加', () => {
    const seq = sequence([]);
    expect(withLiveCaption(seq)).toBe(seq);
  });
});

describe('liveCaptionDocuments', () => {
  it('字幕正文是序列时钟的毫秒，样式是默认预设', () => {
    const [caption, style] = liveCaptionDocuments(liveCaptionCues([{ key: 'a', start: 1.2345, end: 3.5, text: '你好' }]));
    expect(caption).toMatchObject({ documentId: LIVE_CAPTION_DOCUMENT_ID, kind: 'caption', lineKind: 'original' });
    expect(caption!.body).toEqual({
      schema: 'baocut.caption/1',
      clock: 'sequence',
      timescale: 1000,
      cues: [{ id: 'live-0', start: 1235, end: 3500, text: '你好' }],
    });
    expect(style).toMatchObject({ documentId: LIVE_CAPTION_STYLE_ID, kind: 'caption-style', body: DEFAULT_CAPTION_STYLE });
  });
});
