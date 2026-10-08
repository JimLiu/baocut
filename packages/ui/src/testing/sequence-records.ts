import type { AudioItem, CaptionItem, DocumentRecord, Marker, Sequence, Track, VideoItem } from '@baocut/protocol';

/** 导出相关测试共用的序列记录：30 fps、1920×1080。 */
const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };

export function track(id: string, kind: Track['kind'], order: number, extra: Partial<Track> = {}): Track {
  return { id, order, kind, locked: false, visible: true, muted: false, solo: { enabled: false, group: kind === 'audio' ? 'audio' : 'visual' }, ...extra };
}

export function videoItem(id: string, trackId: string, fromFrame: number, durationFrames: number, extra: Partial<VideoItem> = {}): VideoItem {
  return {
    ...base,
    id,
    trackId,
    type: 'video',
    span: { fromFrame, durationFrames },
    place: {},
    mode: 'fullscreen',
    assetRef: { id: 'asset_v', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: 0, timescale: 30 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
    ...extra,
  } as VideoItem;
}

export function audioItem(id: string, trackId: string, fromFrame: number, seconds: number, extra: Partial<AudioItem> = {}): AudioItem {
  return {
    ...base,
    id,
    trackId,
    type: 'audio',
    assetRef: { id: 'asset_a', revision: '1' },
    fromFrame,
    subframeOffset: { ticks: 0, timescale: 48000 },
    playDuration: { ticks: seconds * 48000, timescale: 48000 },
    timeMap: { kind: 'linear', sourceIn: { ticks: 0, timescale: 48000 }, rate: { num: 1, den: 1 } },
    mix: { volume: 1 },
    ...extra,
  } as AudioItem;
}

export function captionItem(id: string, trackId: string, documentId: string, fromFrame = 0, durationFrames = 300, extra: Partial<CaptionItem> = {}): CaptionItem {
  return { ...base, id, trackId, type: 'caption', span: { fromFrame, durationFrames }, documentId, ...extra };
}

export function chapter(id: string, frame: number, label: string, extra: Partial<Marker> = {}): Marker {
  return { id, frame, label, kind: 'chapter', ...extra };
}

export function documentRecord(id: string, kind: string, name: string, extra: Partial<DocumentRecord> = {}): DocumentRecord {
  return { id, kind, name, currentRevision: '1', revisions: {}, ...extra };
}

export function sequence(tracks: Track[], items: Sequence['items'], extra: Partial<Sequence> = {}): Sequence {
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
    ...extra,
  };
}
