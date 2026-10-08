import { describe, expect, it } from 'vitest';
import type {
  AssetRecord,
  CaptionItem,
  CompositionItem,
  DocumentRecord,
  Sequence,
  SequenceItem,
  TextItem,
  Track,
  VideoItem,
} from '@baocut/protocol';
import {
  clipKind,
  formatTimecode,
  itemFrames,
  itemLabel,
  parseSecondsInput,
  playButtonState,
  rulerLabel,
  rulerStep,
  snapFrame,
  snapTargets,
  trackAccepts,
  trackRows,
  videoSlots,
} from './editor.ts';

const fps = { num: 30, den: 1 };

function track(id: string, order: number, kind: Track['kind'], patch: Partial<Track> = {}): Track {
  return {
    id,
    order,
    kind,
    locked: false,
    visible: true,
    muted: false,
    solo: { enabled: false, group: kind === 'audio' ? 'audio' : 'visual' },
    ...patch,
  };
}

function video(id: string, trackId: string, fromFrame: number, durationFrames: number, sourceIn = '0'): VideoItem {
  return {
    id,
    trackId,
    type: 'video',
    enabled: true,
    locked: false,
    paintOrder: 0,
    followPolicy: { kind: 'sequence-fixed' },
    span: { fromFrame, durationFrames },
    place: {},
    mode: 'fullscreen',
    assetRef: { id: 'asset_v', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: sourceIn, timescale: 30 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
  };
}

const itemBase = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };
const fullFrame = { place: {} };

function text(id: string, trackId: string, content: string): TextItem {
  return { ...itemBase, ...fullFrame, id, trackId, type: 'text', span: { fromFrame: 0, durationFrames: 60 }, text: content, style: {} };
}

function composition(id: string, trackId: string, fromFrame: number, source: CompositionItem['source'] = BUNDLE): CompositionItem {
  return {
    ...itemBase,
    ...fullFrame,
    id,
    trackId,
    type: 'composition',
    span: { fromFrame, durationFrames: 30 },
    source,
    parameterValues: {},
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 30 }, rate: { num: 1, den: 1 } },
  };
}

/** 合成只有代码包一种来源。 */
const BUNDLE: CompositionItem['source'] = { kind: 'bundle', assetRef: { id: 'asset_b', revision: '1' } };

/** 元素实例（贴纸、进度条、声波……）：只用到类型与素材引用。 */
function element(type: 'sticker' | 'progress' | 'visualizer' | 'confetti', patch: Record<string, unknown> = {}): SequenceItem {
  return {
    ...itemBase,
    ...fullFrame,
    id: 'e',
    trackId: 'v1',
    type,
    span: { fromFrame: 0, durationFrames: 30 },
    ...patch,
  } as unknown as SequenceItem;
}

function caption(id: string, trackId: string, documentId: string): CaptionItem {
  return { ...itemBase, id, trackId, type: 'caption', span: { fromFrame: 15, durationFrames: 45 }, documentId };
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

describe('编辑器模型', () => {
  it('轨道行：视觉轨道序号大的在上，音频在下', () => {
    const seq = sequence([track('v1', 0, 'visual'), track('a1', 1, 'audio'), track('v2', 2, 'visual')], []);
    expect(trackRows(seq).map((r) => r.label)).toEqual(['画面 2', '画面 1', '音频']);
  });

  it('轨道行：字幕与画面是同一叠，按 order 排，同类不止一条时按顺序编号', () => {
    const seq = sequence([track('v1', 0, 'visual'), track('a1', 1, 'audio'), track('s1', 2, 'subtitle'), track('s2', 3, 'subtitle')], []);
    expect(trackRows(seq).map((r) => r.label)).toEqual(['字幕 2', '字幕 1', '画面', '音频']);
    const over = sequence([track('s1', 0, 'subtitle'), track('v1', 1, 'visual'), track('s2', 2, 'subtitle'), track('v2', 3, 'visual')], []);
    expect(trackRows(over).map((r) => r.label)).toEqual(['画面 2', '字幕 2', '画面 1', '字幕 1']);
  });

  it('轨道行：有名字的轨道写「类别 · 名字」，不再编号', () => {
    const seq = sequence(
      [track('s1', 0, 'subtitle', { name: '英文' }), track('s2', 1, 'subtitle'), track('a1', 2, 'audio', { name: '原声' })],
      [],
    );
    expect(trackRows(seq).map((r) => r.label)).toEqual(['字幕 2', '字幕 · 英文', '音频 · 原声']);
  });

  it('轨道行：引擎默认的 V1、A1 代号不当名字', () => {
    const seq = sequence([track('v1', 0, 'visual', { name: 'V1' }), track('a1', 1, 'audio', { name: 'A1' })], []);
    expect(trackRows(seq).map((r) => r.label)).toEqual(['画面', '音频']);
  });

  it('实例进哪类轨道：字幕只进字幕轨道，文字、图形、合成进视觉轨道', () => {
    const [visual, audio, subtitle] = [track('v1', 0, 'visual'), track('a1', 1, 'audio'), track('s1', 2, 'subtitle')];
    expect((['video', 'image', 'text', 'shape', 'composition'] as const).every((type) => trackAccepts(visual!, { type }))).toBe(true);
    expect(trackAccepts(visual!, { type: 'caption' })).toBe(false);
    expect(trackAccepts(visual!, { type: 'audio' })).toBe(false);
    expect(trackAccepts(audio!, { type: 'audio' })).toBe(true);
    expect(trackAccepts(audio!, { type: 'text' })).toBe(false);
    expect(trackAccepts(subtitle!, { type: 'caption' })).toBe(true);
    expect(trackAccepts(subtitle!, { type: 'video' })).toBe(false);
  });

  it('实例的名字：自己的名字优先，否则取文字内容、素材名、元素种类名、字幕文档名', () => {
    const assets = {
      asset_v: { id: 'asset_v', kind: 'video', name: 'clip.mp4', currentRevision: '1', revisions: {} },
      asset_b: { id: 'asset_b', kind: 'bundle', name: '片头', currentRevision: '1', revisions: {} },
    } satisfies Record<string, AssetRecord>;
    const documents: Record<string, DocumentRecord> = {
      doc_1: { id: 'doc_1', kind: 'caption', name: '中文字幕', currentRevision: '1', revisions: {} },
    };
    const label = (item: Sequence['items'][number]) => itemLabel(item, assets, documents);
    expect(label(video('a', 'v1', 0, 30))).toBe('clip.mp4');
    expect(label({ ...video('a', 'v1', 0, 30), name: '开场' })).toBe('开场');
    expect(label(text('t', 'v1', '第一行\n  第二行'))).toBe('第一行 第二行');
    expect(label(text('t', 'v1', '  '))).toBe('文字');
    expect(
      label({
        ...itemBase,
        ...fullFrame,
        id: 's',
        trackId: 'v1',
        type: 'shape',
        span: { fromFrame: 0, durationFrames: 30 },
        shape: { shape: 'rect' },
      }),
    ).toBe('图形');
    expect(label({ ...text('t', 'v1', ''), text: undefined, counter: { mode: 'countdown' } })).toBe('计数器');
    expect(label(element('sticker', { sticker: { source: 'template', templateId: 'heart' } }))).toBe('贴纸');
    expect(label(element('sticker', { assetRef: { id: 'asset_v', revision: '1' }, sticker: { source: 'asset' } }))).toBe('clip.mp4');
    expect(label(element('visualizer'))).toBe('波形');
    expect(label(element('progress'))).toBe('进度条');
    expect(label(composition('k', 'v1', 0, { kind: 'bundle', assetRef: { id: 'asset_b', revision: '1' } }))).toBe('片头');
    expect(label(composition('k', 'v1', 0, { kind: 'bundle', assetRef: { id: 'gone', revision: '1' } }))).toBe('合成');
    expect(label(caption('c', 's1', 'doc_1'))).toBe('中文字幕');
    expect(label(caption('c', 's1', 'gone'))).toBe('字幕');
    expect(itemFrames(caption('c', 's1', 'doc_1'), fps)).toEqual({ start: 15, end: 60 });
  });

  it('时间线块的类别：元素按自己的类型，带计时读数的文字算计数器，代码包是合成', () => {
    expect(clipKind(video('a', 'v1', 0, 30))).toBe('video');
    expect(clipKind(text('t', 'v1', 'hi'))).toBe('text');
    expect(clipKind(caption('c', 's1', 'doc_1'))).toBe('caption');
    expect(clipKind({ ...text('t', 'v1', ''), counter: { mode: 'countup' } })).toBe('counter');
    expect((['progress', 'sticker', 'visualizer', 'confetti'] as const).map((type) => clipKind(element(type)))).toEqual([
      'progress',
      'sticker',
      'visualizer',
      'confetti',
    ]);
    expect(clipKind(composition('k', 'v1', 0, { kind: 'bundle', assetRef: { id: 'asset_b', revision: '1' } }))).toBe('composition');
  });

  it('预览的视频元素：带预渲染替身的合成也占替身素材的元素，没有替身的合成不占', () => {
    const prerender = { id: 'asset_p', revision: '1' };
    const seq = sequence(
      [track('v1', 0, 'visual'), track('v2', 1, 'visual')],
      [
        video('a', 'v1', 0, 60),
        { ...composition('k1', 'v2', 0), prerender },
        { ...composition('k2', 'v1', 60), prerender: { id: 'asset_v', revision: '1' } },
        composition('k3', 'v2', 30),
      ],
    );
    expect(videoSlots(seq).map(({ asset, count }) => [asset.id, count])).toEqual([
      ['asset_v', 1],
      ['asset_p', 1],
    ]);
  });

  it('预览的视频元素：同一素材同一帧上用到几处就要几个，首尾相接的共用一个', () => {
    const seq = sequence(
      [track('v1', 0, 'visual'), track('v2', 1, 'visual')],
      [video('a', 'v1', 0, 30), video('b', 'v1', 30, 30), video('c', 'v2', 15, 30), { ...video('d', 'v2', 0, 90), enabled: false }],
    );
    expect(videoSlots(seq).map(({ asset, count }) => [asset.id, count])).toEqual([['asset_v', 2]]);
    expect(videoSlots(sequence([track('v1', 0, 'visual')], [video('a', 'v1', 0, 30), video('b', 'v1', 30, 30)]))[0]?.count).toBe(1);
  });

  it('预览的视频元素：拆开的两段之间有两侧转场时，窗口里同一素材要两个元素；单侧转场不加', () => {
    const base = sequence([track('v1', 0, 'visual')], [video('a', 'v1', 0, 30), video('b', 'v1', 30, 30, '30')]);
    const dissolve = {
      id: 't1',
      leftItemId: 'a',
      rightItemId: 'b',
      kind: 'dissolve',
      durationFrames: 10,
      easing: 'linear',
      placement: 'center',
    } as const;
    expect(videoSlots({ ...base, transitions: [dissolve] })[0]?.count).toBe(2);
    expect(videoSlots({ ...base, transitions: [{ ...dissolve, rightItemId: undefined }] })[0]?.count).toBe(1);
  });

  it('吸附：阈值内取最近的目标，不吸附正在拖的实例', () => {
    const seq = sequence([track('v1', 0, 'visual')], [video('a', 'v1', 0, 30), video('b', 'v1', 60, 30)]);
    const targets = snapTargets(seq, 45, new Set(['b']));
    expect(targets.sort((x, y) => x - y)).toEqual([0, 30, 45]);
    expect(snapFrame(33, targets, 4)).toEqual({ frame: 30, snapped: 30 });
    expect(snapFrame(38, targets, 4)).toEqual({ frame: 38, snapped: null });
  });

  it('刻度与时码', () => {
    expect(rulerStep(40).major).toBe(2);
    expect(rulerStep(400).major).toBe(0.2);
    expect(rulerLabel(65, 5)).toBe('1:05');
    expect(rulerLabel(1.5, 0.5)).toBe('0:01.5');
    expect(formatTimecode(5 + 12 / 30, fps)).toBe('00:00:05:12');
    // 29.97 fps：3661 秒落在一帧的中间，那一帧从 3660.99 秒开始，按真实时间显示（不是丢帧时码）。
    expect(formatTimecode(3661, { num: 30000, den: 1001 })).toBe('01:01:00:29');
  });

  it('播放键三态：在播是暂停，停在片尾（差不到 0.05 秒）是重播', () => {
    expect(playButtonState({ playing: false, playhead: 0, duration: 10 })).toBe('play');
    expect(playButtonState({ playing: true, playhead: 3, duration: 10 })).toBe('pause');
    // 在播时到了片尾也是暂停：引擎播到头才停。
    expect(playButtonState({ playing: true, playhead: 10, duration: 10 })).toBe('pause');
    expect(playButtonState({ playing: false, playhead: 10, duration: 10 })).toBe('replay');
    expect(playButtonState({ playing: false, playhead: 9.96, duration: 10 })).toBe('replay');
    expect(playButtonState({ playing: false, playhead: 9.9, duration: 10 })).toBe('play');
    // 空时间线（总长 0）无所谓片尾：显示播放，不显示重播。
    expect(playButtonState({ playing: false, playhead: 0, duration: 0 })).toBe('play');
  });

  it('秒数输入：十进制字符串原样交给引擎，「分:秒」换算成秒', () => {
    expect(parseSecondsInput('10')).toBe('10');
    expect(parseSecondsInput(' 10.010 秒')).toBe('10.010');
    expect(parseSecondsInput('1:05.5')).toBe('65.5');
    expect(parseSecondsInput('007.5')).toBe('7.5');
    expect(parseSecondsInput('-1')).toBeNull();
    expect(parseSecondsInput('abc')).toBeNull();
  });
});
