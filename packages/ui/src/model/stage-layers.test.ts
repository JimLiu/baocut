import { describe, expect, it } from 'vitest';
import type { AudioItem, CaptionItem, DocumentRecord, Sequence, Track } from '@baocut/protocol';
import { MUSIC_ROLE } from './music-bed.ts';
import {
  CAPTION_LAYERS_SHOWN,
  captionLayerShown,
  captionsAllHidden,
  hasLayerToggles,
  hasMusic,
  layerCaptionMode,
  layerToggles,
  layersPartlyHidden,
  withoutMusic,
} from './stage-layers.ts';

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
const audio = (id: string, trackId: string, extra: Partial<AudioItem> = {}): AudioItem =>
  ({
    ...base,
    id,
    trackId,
    type: 'audio',
    span: { fromFrame: 0, durationFrames: 300 },
    assetRef: { id: 'a', revision: '1' },
    ...extra,
  }) as AudioItem;

function sequence(tracks: Track[], items: Sequence['items']): Sequence {
  return {
    id: 'seq',
    revision: '1',
    name: 'main',
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

const tracks = [track('s1', 1, 'subtitle'), track('s2', 2, 'subtitle'), track('m1', 3, 'audio'), track('m2', 4, 'audio', { muted: true })];

describe('图层开关按视频实有的生成（轻量编辑器设计 §3.4）', () => {
  it('字幕按原文 / 译文各一个，配乐看有没有听得见的 role: music 音频实例', () => {
    const full = sequence(tracks, [caption('a', 's1', 'orig'), caption('b', 's2', 'en'), audio('m', 'm1', { role: MUSIC_ROLE })]);
    expect(layerToggles(full, documents)).toEqual({ captions: ['original', 'translation'], music: true });
    const onlyTranslation = sequence(tracks, [caption('b', 's2', 'en'), audio('v', 'm1')]);
    expect(layerToggles(onlyTranslation, documents)).toEqual({ captions: ['translation'], music: false });
  });

  it('拿下的字幕、停用的或在静音轨上的配乐不算；什么都没有时不摆钮', () => {
    const none = sequence(tracks, [
      caption('a', 's1', 'orig', { enabled: false }),
      audio('m', 'm1', { role: MUSIC_ROLE, enabled: false }),
      audio('n', 'm2', { role: MUSIC_ROLE }),
    ]);
    expect(hasMusic(none)).toBe(false);
    const toggles = layerToggles(none, documents);
    expect(toggles).toEqual({ captions: [], music: false });
    expect(hasLayerToggles(toggles)).toBe(false);
    expect(hasLayerToggles({ captions: [], music: true })).toBe(true);
  });
});

describe('开关 → 字幕档位', () => {
  const both = ['original', 'translation'] as const;
  it('都开是照原样（null），只开原文 source，只开译文 trans，都关 off', () => {
    expect(layerCaptionMode(false, CAPTION_LAYERS_SHOWN, both)).toBeNull();
    expect(layerCaptionMode(false, { original: false, translation: true }, both)).toBe('source');
    expect(layerCaptionMode(false, { original: true, translation: false }, both)).toBe('trans');
    expect(layerCaptionMode(false, { original: true, translation: true }, both)).toBe('off');
  });

  it('按画面上有的种类算：只有原文时开着就是照原样；舞台隐藏字幕时一律 off', () => {
    expect(layerCaptionMode(false, { original: false, translation: true }, ['original'])).toBeNull();
    expect(layerCaptionMode(false, { original: true, translation: false }, ['original'])).toBe('off');
    expect(layerCaptionMode(true, CAPTION_LAYERS_SHOWN, both)).toBe('off');
    expect(layerCaptionMode(false, CAPTION_LAYERS_SHOWN, [])).toBeNull();
  });

  it('全藏只看画面上有的种类；没有字幕不算藏', () => {
    expect(captionsAllHidden({ original: true, translation: false }, ['original'])).toBe(true);
    expect(captionsAllHidden({ original: true, translation: false }, both)).toBe(false);
    expect(captionsAllHidden({ original: true, translation: true }, [])).toBe(false);
  });

  it('开关的开合与钮上的「有关着的」', () => {
    expect(captionLayerShown(true, CAPTION_LAYERS_SHOWN, 'original')).toBe(false);
    expect(captionLayerShown(false, { original: false, translation: true }, 'translation')).toBe(false);
    const toggles = { captions: ['original' as const], music: true };
    const state = { captionsHidden: false, captionLayersHidden: CAPTION_LAYERS_SHOWN, musicHidden: false };
    expect(layersPartlyHidden(toggles, state)).toBe(false);
    expect(layersPartlyHidden(toggles, { ...state, musicHidden: true })).toBe(true);
    // 关掉的种类已经不在画面上了，不算。
    expect(layersPartlyHidden(toggles, { ...state, captionLayersHidden: { original: false, translation: true } })).toBe(false);
    expect(layersPartlyHidden({ captions: [], music: false }, { ...state, musicHidden: true })).toBe(false);
  });
});

describe('监听时去掉配乐', () => {
  it('只停用启用着的配乐实例，别的声音不动；没有要停的时原样返回', () => {
    const seq = sequence(tracks, [
      audio('m', 'm1', { role: MUSIC_ROLE }),
      audio('v', 'm1'),
      audio('x', 'm1', { role: MUSIC_ROLE, enabled: false }),
    ]);
    const muted = withoutMusic(seq);
    expect(muted.items.map((item) => [item.id, item.enabled])).toEqual([
      ['m', false],
      ['v', true],
      ['x', false],
    ]);
    expect(seq.items[0]!.enabled).toBe(true);
    const plain = sequence(tracks, [audio('v', 'm1')]);
    expect(withoutMusic(plain)).toBe(plain);
  });
});
