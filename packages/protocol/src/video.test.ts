import { describe, expect, it } from 'vitest';
import {
  applyVideoEvent,
  itemAssetRef,
  itemAssetRefs,
  itemRangeSeconds,
  itemTimeMap,
  sequenceDurationFrames,
  type AudioItem,
  type CaptionItem,
  type CompositionItem,
  type VideoEvent,
  type VideoSnapshot,
  type VideoTopicSnapshot,
  type Sequence,
  type Track,
  type VideoItem,
} from './video.ts';

const fps = { num: 30, den: 1 };

function track(id: string, order: number, kind: Track['kind']): Track {
  return {
    id,
    order,
    kind,
    locked: false,
    visible: true,
    muted: false,
    solo: { enabled: false, group: kind === 'audio' ? 'audio' : 'visual' },
  };
}

function videoItem(id: string, trackId: string, fromFrame: number, durationFrames: number): VideoItem {
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
    assetRef: { id: 'asset_1', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
  };
}

function base(): VideoTopicSnapshot {
  const sequence: Sequence = {
    id: 'seq_1',
    revision: '1',
    name: '主序列',
    fps,
    canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
    durationPolicy: { kind: 'derived' },
    tracks: [track('trk_v1', 0, 'visual'), track('trk_a1', 1, 'audio')],
    items: [videoItem('item_a', 'trk_v1', 0, 60)],
    animationBindings: [],
    transitions: [],
    markers: [],
    ducking: [],
  };
  const video: VideoSnapshot = {
    format: 'baocut.video',
    schemaVersion: 3,
    timeContractVersion: 1,
    id: 'video_1',
    name: '测试',
    revision: '1',
    rootSequenceId: 'seq_1',
    sequences: { seq_1: sequence },
    assets: {},
    documents: {},
    fonts: {},
    localizationSets: {},
    canvasVariants: {},
    syncGroups: {},
    protections: {},
    checkpoints: {},
    links: [],
  };
  return { video, eventSeq: '1' };
}

function event(eventSeq: string, projection: VideoEvent['projection'], revision = eventSeq): VideoEvent {
  return {
    videoId: 'video_1',
    eventSeq,
    videoRevision: revision,
    transactionId: `tx_${eventSeq}`,
    changedIds: [],
    projection,
    actor: { kind: 'user', id: 'user_local' },
    label: '移动片段',
  };
}

describe('applyVideoEvent', () => {
  it('应用实例的增删改，按轨道与起点排序，不修改输入', () => {
    const state = base();
    const header = {
      id: 'seq_1',
      revision: '2',
      name: '主序列',
      fps,
      canvas: state.video.sequences.seq_1!.canvas,
      durationPolicy: { kind: 'derived' },
    };
    const next = applyVideoEvent(
      state,
      event('2', {
        upserts: [
          { kind: 'sequence', id: 'seq_1', value: header },
          { kind: 'item', id: 'item_b', sequenceId: 'seq_1', value: videoItem('item_b', 'trk_v1', 0, 30) },
          { kind: 'item', id: 'item_a', sequenceId: 'seq_1', value: videoItem('item_a', 'trk_v1', 30, 60) },
        ],
        removals: [],
      }),
    );
    expect(next.eventSeq).toBe('2');
    expect(next.video.revision).toBe('2');
    expect(next.video.sequences.seq_1!.revision).toBe('2');
    expect(next.video.sequences.seq_1!.items.map((i) => i.id)).toEqual(['item_b', 'item_a']);
    expect(state.video.sequences.seq_1!.items.map((i) => i.id)).toEqual(['item_a']);
    expect(sequenceDurationFrames(next.video.sequences.seq_1!)).toBe(90);

    const removed = applyVideoEvent(next, event('3', { upserts: [], removals: [{ kind: 'item', id: 'item_b', sequenceId: 'seq_1' }] }));
    expect(removed.video.sequences.seq_1!.items.map((i) => i.id)).toEqual(['item_a']);
  });

  it('重复投递的事件原样返回', () => {
    const state = base();
    expect(applyVideoEvent(state, event('1', { upserts: [{ kind: 'video', id: 'video_1', value: { name: 'x' } }], removals: [] }))).toBe(
      state,
    );
  });

  it('转场、标记与闪避规则的投影：按序列归位并排序，删除后移走', () => {
    const state = base();
    const fade = (id: string, left: string, right: string) => ({
      id,
      leftItemId: left,
      rightItemId: right,
      kind: 'dissolve',
      durationFrames: 10,
      easing: 'linear',
      placement: 'center',
    });
    const chapter = (id: string, frame: number) => ({ id, frame, label: id, kind: 'chapter' });
    const duck = {
      id: 'duck_1',
      enabled: true,
      trigger: { kind: 'items', trackIds: ['trk_a1'] },
      target: { itemIds: ['item_a'] },
      depth: 10,
      attack: { ticks: '1', timescale: 50 },
      release: { ticks: '7', timescale: 20 },
    };
    const next = applyVideoEvent(
      state,
      event('2', {
        upserts: [
          { kind: 'transition', id: 'tr_b', sequenceId: 'seq_1', value: fade('tr_b', 'item_b', 'item_c') },
          { kind: 'transition', id: 'tr_a', sequenceId: 'seq_1', value: fade('tr_a', 'item_a', 'item_b') },
          { kind: 'marker', id: 'chap_2', sequenceId: 'seq_1', value: chapter('chap_2', 90) },
          { kind: 'marker', id: 'chap_1', sequenceId: 'seq_1', value: chapter('chap_1', 0) },
          { kind: 'ducking', id: 'duck_1', sequenceId: 'seq_1', value: duck },
        ],
        removals: [],
      }),
    );
    const seq = next.video.sequences.seq_1!;
    expect(seq.transitions.map((t) => t.id)).toEqual(['tr_a', 'tr_b']);
    expect(seq.markers.map((m) => [m.id, m.frame])).toEqual([
      ['chap_1', 0],
      ['chap_2', 90],
    ]);
    expect(seq.ducking).toEqual([duck]);
    expect(state.video.sequences.seq_1!.transitions).toEqual([]);
    expect(state.video.sequences.seq_1!.ducking).toEqual([]);

    // 改一章的时间会重新排序；删掉的转场与规则不再出现。
    const moved = applyVideoEvent(
      next,
      event('3', {
        upserts: [{ kind: 'marker', id: 'chap_1', sequenceId: 'seq_1', value: chapter('chap_1', 120) }],
        removals: [
          { kind: 'transition', id: 'tr_a', sequenceId: 'seq_1' },
          { kind: 'ducking', id: 'duck_1', sequenceId: 'seq_1' },
        ],
      }),
    );
    const after = moved.video.sequences.seq_1!;
    expect(after.markers.map((m) => m.id)).toEqual(['chap_2', 'chap_1']);
    expect(after.transitions.map((t) => t.id)).toEqual(['tr_b']);
    expect(after.ducking).toEqual([]);
    expect(seq.markers.map((m) => m.id)).toEqual(['chap_1', 'chap_2']);
  });

  it('视频、素材与轨道的投影', () => {
    const next = applyVideoEvent(
      base(),
      event('2', {
        upserts: [
          { kind: 'video', id: 'video_1', value: { name: '改名了', rootSequenceId: 'seq_1' } },
          { kind: 'track', id: 'trk_v2', sequenceId: 'seq_1', value: track('trk_v2', 2, 'visual') },
          {
            kind: 'asset',
            id: 'asset_1',
            value: { id: 'asset_1', kind: 'video', name: 'a.mp4', currentRevision: '1', revisions: {} },
          },
        ],
        removals: [],
      }),
    );
    expect(next.video.name).toBe('改名了');
    expect(next.video.sequences.seq_1!.tracks.map((t) => t.id)).toEqual(['trk_v1', 'trk_a1', 'trk_v2']);
    expect(next.video.assets.asset_1?.name).toBe('a.mp4');
  });

  it('文档头的投影：写入新版本替换文档头，删除后不在快照里', () => {
    const header = {
      id: 'doc_1',
      kind: 'caption',
      name: '字幕',
      currentRevision: '1',
      revisions: { '1': { revision: '1', contentHash: 'h', byteLength: 2, createdAt: '2026-01-01T00:00:00Z', createdBy: 'tx_2' } },
    };
    const state = base();
    const next = applyVideoEvent(state, event('2', { upserts: [{ kind: 'document', id: 'doc_1', value: header }], removals: [] }));
    expect(next.video.documents.doc_1).toEqual(header);
    expect(state.video.documents).toEqual({});
    const removed = applyVideoEvent(next, event('3', { upserts: [], removals: [{ kind: 'document', id: 'doc_1' }] }));
    expect(removed.video.documents).toEqual({});
  });

  it('字幕实例在帧网格上，算进序列长度；它没有素材与时间映射', () => {
    const caption: CaptionItem = {
      id: 'item_c',
      trackId: 'trk_s1',
      type: 'caption',
      enabled: true,
      locked: false,
      paintOrder: 0,
      followPolicy: { kind: 'sequence-fixed' },
      span: { fromFrame: 30, durationFrames: 90 },
      documentId: 'doc_1',
    };
    expect(itemRangeSeconds(caption, fps)).toEqual({ start: 1, end: 4 });
    const sequence = base().video.sequences.seq_1!;
    expect(sequenceDurationFrames({ ...sequence, items: [...sequence.items, caption] })).toBe(120);
    expect(itemAssetRef(caption)).toBeUndefined();
    expect(itemAssetRefs(caption)).toEqual([]);
    expect(itemTimeMap(caption)).toBeUndefined();
  });

  it('合成实例引用的素材：代码包，加上预渲染替身', () => {
    const composition: CompositionItem = {
      id: 'item_k',
      trackId: 'trk_v1',
      type: 'composition',
      enabled: true,
      locked: false,
      paintOrder: 0,
      followPolicy: { kind: 'sequence-fixed' },
      span: { fromFrame: 0, durationFrames: 30 },
      place: {},
      source: { kind: 'bundle', assetRef: { id: 'asset_b', revision: '1' } },
      parameterValues: {},
      timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
      prerender: { id: 'asset_p', revision: '2' },
    };
    expect(itemAssetRef(composition)).toEqual({ id: 'asset_b', revision: '1' });
    expect(itemAssetRefs(composition).map((ref) => ref.id)).toEqual(['asset_b', 'asset_p']);
    expect(itemTimeMap(composition)).toBe(composition.timeMap);
  });

  it('音频实例的区间带子帧偏移', () => {
    const audio: AudioItem = {
      id: 'item_au',
      trackId: 'trk_a1',
      type: 'audio',
      enabled: true,
      locked: false,
      paintOrder: 0,
      followPolicy: { kind: 'sequence-fixed' },
      assetRef: { id: 'asset_2', revision: '1' },
      fromFrame: 30,
      subframeOffset: { ticks: '1', timescale: 60 },
      playDuration: { ticks: '3', timescale: 2 },
      timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
      mix: { volume: 1 },
    };
    const range = itemRangeSeconds(audio, fps);
    expect(range.start).toBeCloseTo(1 + 1 / 60);
    expect(range.end).toBeCloseTo(2.5 + 1 / 60);
  });
});
