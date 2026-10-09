import { describe, expect, it } from 'vitest';
import type { AssetRecord, CaptionItem, DocumentRecord, Sequence, Track, VideoItem } from '@baocut/protocol';
import {
  IDLE_MS,
  PLAYER_KEYS,
  captionAvailability,
  captionModes,
  captionView,
  chapterTicks,
  chromeHidden,
  cycleCaptionMode,
  defaultCaptionMode,
  effectiveCaptionMode,
  holdingVisible,
  percentTime,
  previewSize,
  resolvePlayerKey,
  seekFraction,
  seekFrame,
  stepTime,
  timeAt,
  type PlayerAction,
} from './player.ts';

const track = (id: string, order: number, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({
  id,
  order,
  kind,
  locked: false,
  visible: true,
  muted: false,
  solo: { enabled: false, group: 'visual' },
  ...extra,
});

const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };
const caption = (id: string, trackId: string, documentId: string, extra: Partial<CaptionItem> = {}): CaptionItem => ({
  ...base,
  id,
  trackId,
  type: 'caption',
  span: { fromFrame: 0, durationFrames: 300 },
  documentId,
  ...extra,
});

const linear = (seconds: number): VideoItem['timeMap'] => ({
  kind: 'linear',
  sourceIn: { ticks: String(seconds * 1000), timescale: 1000 },
  rate: { num: 1, den: 1 },
});
const clip = (id: string, trackId: string, fromFrame: number, durationFrames: number, assetId: string, timeMap = linear(0), enabled = true) =>
  ({ ...base, id, type: 'video', trackId, enabled, span: { fromFrame, durationFrames }, assetRef: { id: assetId, revision: '1' }, timeMap }) as unknown as VideoItem;

function sequence(tracks: Track[], items: Sequence['items']): Sequence {
  return {
    id: 'seq',
    revision: '1',
    name: '主序列',
    fps: { num: 30, den: 1 },
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

const doc = (id: string, kind: string, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id,
  kind,
  name: id,
  currentRevision: '1',
  revisions: {},
  ...extra,
});
const documents: Record<string, DocumentRecord> = {
  speech: doc('speech', 'speech'),
  trans: doc('trans', 'translation', { language: 'en' }),
  orig: doc('orig', 'caption', { sourceDocumentId: 'speech' }),
  en: doc('en', 'caption', { sourceDocumentId: 'trans', language: 'en' }),
};

describe('控件的收起判据', () => {
  const idle = { playing: true, hovering: false, holding: false, idleMs: IDLE_MS };
  it('只有在播、不在条上、没按住、空闲满 3 秒才收', () => {
    expect(chromeHidden(idle)).toBe(true);
    expect(chromeHidden({ ...idle, idleMs: IDLE_MS - 1 })).toBe(false);
    expect(chromeHidden({ ...idle, playing: false })).toBe(false);
    expect(chromeHidden({ ...idle, hovering: true })).toBe(false);
    expect(chromeHidden({ ...idle, holding: true })).toBe(false);
  });

  it('拖着进度条、开着弹层、拖着音量都算按住', () => {
    const none = { scrubbing: false, popup: false, volumeDragging: false };
    expect(holdingVisible(none)).toBe(false);
    expect(holdingVisible({ ...none, scrubbing: true })).toBe(true);
    expect(holdingVisible({ ...none, popup: true })).toBe(true);
    expect(holdingVisible({ ...none, volumeDragging: true })).toBe(true);
  });
});

describe('进度与跳转', () => {
  it('比例夹在 0–1，时长为 0 时恒 0', () => {
    expect(seekFraction(5, 10)).toBe(0.5);
    expect(seekFraction(15, 10)).toBe(1);
    expect(seekFraction(-1, 10)).toBe(0);
    expect(seekFraction(3, 0)).toBe(0);
  });

  it('横坐标换成秒，夹在 [0, 时长]', () => {
    const rect = { left: 100, width: 200 };
    expect(timeAt(200, rect, 60)).toBe(30);
    expect(timeAt(0, rect, 60)).toBe(0);
    expect(timeAt(400, rect, 60)).toBe(60);
    expect(timeAt(200, { left: 0, width: 0 }, 60)).toBe(0);
  });

  it('步进夹在 [0, 时长]；0–9 是时长的 0%–90%', () => {
    expect(stepTime(3, -5, 60)).toBe(0);
    expect(stepTime(58, 5, 60)).toBe(60);
    expect(stepTime(10, 10, 60)).toBe(20);
    expect(percentTime(0, 60)).toBe(0);
    expect(percentTime(5, 60)).toBe(30);
    expect(percentTime(9, 60)).toBeCloseTo(54);
    expect(percentTime(5, 0)).toBe(0);
  });

  it('章节刻痕不画首章的 0，也不画片尾及以后的', () => {
    expect(chapterTicks([{ start: 0 }, { start: 15 }, { start: 30 }, { start: 60 }], 60)).toEqual([0.25, 0.5]);
    expect(chapterTicks([{ start: 15 }], 0)).toEqual([]);
  });

  it('预览格宽 160 按画布比例，竖片高不超过 120', () => {
    expect(previewSize({ width: 1920, height: 1080 })).toEqual({ width: 160, height: 90 });
    expect(previewSize({ width: 1080, height: 1920 })).toEqual({ width: 68, height: 120 });
  });
});

describe('悬停气泡的那一格画面', () => {
  const assets = {
    movie: { revisions: { '1': { video: { displayWidth: 1920 } } } },
    cover: { revisions: { '1': { video: { displayWidth: 1920 } } } },
    sound: { revisions: { '1': {} } },
  } as unknown as Record<string, AssetRecord>;

  it('取这一刻最上层、启用着、轨道可见、有画面的视频片段，换到素材的源时间', () => {
    const seq = sequence(
      [track('v1', 1, 'visual'), track('v2', 2, 'visual'), track('v3', 3, 'visual', { visible: false })],
      [
        clip('main', 'v1', 0, 3000, 'movie', linear(10)),
        clip('top', 'v2', 300, 300, 'cover', linear(2)),
        clip('hidden', 'v3', 0, 3000, 'cover'),
        clip('off', 'v2', 0, 300, 'cover', linear(0), false),
      ],
    );
    // 100 秒的片子按 1 秒取整：4.6 秒落在 4 秒那一格。
    expect(seekFrame(seq, assets, 4.6)).toEqual({ asset: { id: 'movie', revision: '1' }, at: 14 });
    expect(seekFrame(seq, assets, 12.5)).toEqual({ asset: { id: 'cover', revision: '1' }, at: 4 });
    expect(seekFrame(seq, assets, 120)).toBeNull();
  });

  it('取整落到片段开头之前时从片段开头取', () => {
    const seq = sequence([track('v1', 1, 'visual')], [clip('a', 'v1', 0, 15, 'movie'), clip('b', 'v1', 15, 2985, 'movie', linear(40))]);
    expect(seekFrame(seq, assets, 0.9)).toEqual({ asset: { id: 'movie', revision: '1' }, at: 40 });
  });

  it('素材没有画面时不取', () => {
    const seq = sequence([track('v1', 1, 'visual')], [clip('a', 'v1', 0, 300, 'sound')]);
    expect(seekFrame(seq, assets, 1)).toBeNull();
  });
});

describe('字幕四档', () => {
  it('档位按实有的字幕生成，默认能露的都露', () => {
    expect(captionModes(true, true)).toEqual(['off', 'source', 'trans', 'both']);
    expect(captionModes(true, false)).toEqual(['off', 'source']);
    expect(captionModes(false, true)).toEqual(['off', 'trans']);
    expect(captionModes(false, false)).toEqual(['off']);
    expect(defaultCaptionMode(true, true)).toBe('both');
    expect(defaultCaptionMode(true, false)).toBe('source');
    expect(defaultCaptionMode(false, true)).toBe('trans');
    expect(defaultCaptionMode(false, false)).toBe('off');
  });

  it('选过的档不在了回到默认档；C 轮转，不在表里时从表头开始', () => {
    expect(effectiveCaptionMode(null, true, true)).toBe('both');
    expect(effectiveCaptionMode('source', true, true)).toBe('source');
    expect(effectiveCaptionMode('both', true, false)).toBe('source');
    expect(cycleCaptionMode('off', true, true)).toBe('source');
    expect(cycleCaptionMode('both', true, true)).toBe('off');
    expect(cycleCaptionMode('trans', true, false)).toBe('source');
    expect(cycleCaptionMode('off', false, false)).toBe('off');
  });

  it('只看画面上的：拿下的与轨道停用的不算', () => {
    const tracks = [track('s1', 1, 'subtitle'), track('s2', 2, 'subtitle'), track('s3', 3, 'subtitle', { visible: false })];
    expect(captionAvailability(sequence(tracks, [caption('a', 's1', 'orig'), caption('b', 's2', 'en')]), documents)).toEqual({
      hasSource: true,
      hasTranslation: true,
    });
    expect(
      captionAvailability(sequence(tracks, [caption('a', 's1', 'orig', { enabled: false }), caption('b', 's3', 'en')]), documents),
    ).toEqual({ hasSource: false, hasTranslation: false });
  });

  it('按档位停用不该露的字幕，从不放回拿下的；没有要停的时原样返回', () => {
    const tracks = [track('s1', 1, 'subtitle'), track('s2', 2, 'subtitle')];
    const seq = sequence(tracks, [caption('a', 's1', 'orig'), caption('b', 's2', 'en'), caption('c', 's2', 'en', { enabled: false })]);
    const enabled = (s: Sequence) => s.items.map((item) => [item.id, item.enabled]);
    expect(enabled(captionView(seq, documents, 'source'))).toEqual([['a', true], ['b', false], ['c', false]]);
    expect(enabled(captionView(seq, documents, 'trans'))).toEqual([['a', false], ['b', true], ['c', false]]);
    expect(enabled(captionView(seq, documents, 'off'))).toEqual([['a', false], ['b', false], ['c', false]]);
    expect(captionView(seq, documents, 'both')).toBe(seq);
  });
});

describe('键盘', () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
    resolvePlayerKey({ key: k, code: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...extra });

  it('⌘ / Ctrl / ⌥ 一律不接，⇧ 只改左右键', () => {
    expect(key(' ', { metaKey: true })).toBeNull();
    expect(key('k', { ctrlKey: true })).toBeNull();
    expect(key('ArrowLeft', { altKey: true })).toBeNull();
    expect(key('ArrowLeft', { shiftKey: true })).toEqual({ action: 'prevChapter' });
    expect(key('ArrowRight', { shiftKey: true })).toEqual({ action: 'nextChapter' });
    expect(key('K', { shiftKey: true })).toEqual({ action: 'play' });
  });

  it('数字带上是几；字母认不出字符时按物理键位', () => {
    expect(key('7')).toEqual({ action: 'percent', digit: 7 });
    expect(key('Process', { code: 'KeyM' })).toEqual({ action: 'mute' });
    expect(key('x')).toBeNull();
  });

  it('键表上每一行按下去都是这一行的动作', () => {
    for (const row of PLAYER_KEYS) {
      expect(key(row.probe.key, row.probe)?.action, row.keys).toBe(row.action);
    }
  });

  it('接得住的动作都在键表上', () => {
    const listed = new Set<PlayerAction>(PLAYER_KEYS.flatMap((row) => [row.action, ...(row.also ?? [])]));
    const keys = [' ', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', '?', ...'0123456789', ...'abcdefghijklmnopqrstuvwxyz'];
    for (const k of keys)
      for (const shiftKey of [false, true]) {
        const action = key(k, { shiftKey })?.action;
        if (action) expect(listed.has(action), `${shiftKey ? '⇧' : ''}${k} → ${action}`).toBe(true);
      }
  });
});
