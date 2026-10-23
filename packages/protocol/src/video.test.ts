import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from './i18n.ts';
import { localizeText } from './message-ref.ts';
import { methodParamSchemas } from './schemas.ts';
import './messages/video-engine/index.ts';
import {
  applyVideoEvent,
  framingFromCrop,
  itemAssetRef,
  itemAssetRefs,
  itemRangeSeconds,
  itemTimeMap,
  panelLayoutOf,
  panelRects,
  sequenceDisplayName,
  sequenceDurationFrames,
  type AudioItem,
  type CaptionItem,
  type CompositionItem,
  type Crop,
  type FocalPoint,
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

  it('视频头的投影带上视频速览，清掉之后不留旧的', () => {
    const brief = { markdown: '一期访谈。\n\n- [0:26](?t=26) 要点', language: 'zh-Hans' };
    const written = applyVideoEvent(
      base(),
      event('2', { upserts: [{ kind: 'video', id: 'video_1', value: { name: '访谈', rootSequenceId: 'seq_1', brief } }], removals: [] }),
    );
    expect(written.video.brief).toEqual(brief);
    const cleared = applyVideoEvent(
      written,
      event('3', { upserts: [{ kind: 'video', id: 'video_1', value: { name: '访谈', rootSequenceId: 'seq_1' } }], removals: [] }),
    );
    expect('brief' in cleared.video).toBe(false);
    expect(written.video.brief).toEqual(brief);
  });

  it('序列头的投影：改名之后的序列头没有 nameRef，旧的引用不留', () => {
    const state = base();
    const seq = state.video.sequences.seq_1!;
    const header = (name: string, extra: object = {}) => ({
      id: 'seq_1',
      revision: '2',
      name,
      fps,
      canvas: seq.canvas,
      durationPolicy: { kind: 'derived' },
      animationBindings: [],
      ...extra,
    });
    const named = applyVideoEvent(
      state,
      event('2', { upserts: [{ kind: 'sequence', id: 'seq_1', value: header('Main sequence', { nameRef: { key: 'engine.mainSequence' } }) }], removals: [] }),
    );
    expect(named.video.sequences.seq_1!.nameRef).toEqual({ key: 'engine.mainSequence' });
    const renamed = applyVideoEvent(named, event('3', { upserts: [{ kind: 'sequence', id: 'seq_1', value: header('Vertical cut') }], removals: [] }));
    expect(renamed.video.sequences.seq_1!.name).toBe('Vertical cut');
    expect('nameRef' in renamed.video.sequences.seq_1!).toBe(false);
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

/** 序列的缺省名按读者的语言显示（视频格式规范 §3.2）；用户起的名字原样。 */
describe('sequenceDisplayName', () => {
  const created = { name: 'Main sequence', nameRef: { key: 'engine.mainSequence' } };
  const legacy = { name: '主序列' };
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('缺省名与有 nameRef 之前存下的「主序列」都按当前语言显示', () => {
    expect(sequenceDisplayName(created)).toBe('主序列');
    expect(sequenceDisplayName(legacy)).toBe('主序列');
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(sequenceDisplayName(created)).toBe('Main sequence');
    expect(sequenceDisplayName(legacy)).toBe('Main sequence');
    vi.stubEnv('BAOCUT_LOCALE', 'ja');
    setLocale('ja');
    expect(sequenceDisplayName(legacy)).toBe('メインシーケンス');
  });

  describe('用户起的名字', () => {
    beforeEach(() => {
      vi.stubEnv('BAOCUT_LOCALE', 'en');
      setLocale('en');
    });

    it('原样显示，不跟着语言换', () => {
      expect(sequenceDisplayName({ name: 'Vertical cut' })).toBe('Vertical cut');
      expect(sequenceDisplayName({ name: '竖版' })).toBe('竖版');
      expect(sequenceDisplayName({ name: 'Main sequence' })).toBe('Main sequence');
    });
  });
});

/** 引擎起的修改名带引用，按读者的语言显示；撤销、重做与几种修改把别的修改名作为嵌套参数（命令与协议规范 §3.1）。 */
describe('事务的修改名', () => {
  const trim = { key: 'engine.labelTrimClip', text: 'Trim clip' };
  const undoTrim = { key: 'engine.labelUndo', params: { label: trim } };
  const redoNamed = { key: 'engine.labelRedo', params: { label: '整理标题' } };
  const mixed = { key: 'engine.labelMoreChanges', params: { main: { key: 'engine.labelRenameVideo', text: 'Rename video' }, count: 3 } };
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('按当前语言展开嵌套的修改名', () => {
    expect(localizeText('Undo: Trim clip', undoTrim)).toBe('撤销：裁切片段');
    expect(localizeText('Rename video and more (3 changes)', mixed)).toBe('重命名视频等 3 项修改');
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(localizeText('Undo: Trim clip', undoTrim)).toBe('Undo: Trim clip');
    expect(localizeText('Rename video and more (3 changes)', mixed)).toBe('Rename video and more (3 changes)');
    vi.stubEnv('BAOCUT_LOCALE', 'ja');
    setLocale('ja');
    expect(localizeText('Undo: Trim clip', undoTrim)).toBe('取り消し：クリップをトリム');
  });

  it('调用方给的修改名与没有引用的旧记录照原样', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(localizeText('Redo: 整理标题', redoNamed)).toBe('Redo: 整理标题');
    expect(localizeText('撤销：设置章节')).toBe('撤销：设置章节');
  });

  it('edits.apply 收下调用方的修改名引用，只查外形与长度', () => {
    const apply = methodParamSchemas['edits.apply'];
    const base = { videoId: 'v', commandId: 'c', expectedRevision: '0', operations: [{ type: 'renameVideo', name: 'x' }], label: 'Move 2 clips' };
    const nested = { key: 'editLabel.translateTo', params: { language: { key: 'editLabel.languageName', text: 'French' }, count: 2 } };
    expect(apply.parse({ ...base, labelRef: nested }).labelRef).toEqual(nested);
    expect(apply.safeParse({ ...base, labelRef: { key: 'noArea' } }).success).toBe(false);
    expect(apply.safeParse({ ...base, labelRef: { key: 'editLabel.x', extra: 1 } }).success).toBe(false);
    expect(apply.safeParse({ ...base, labelRef: { key: 'editLabel.x', params: { a: { key: 'b.c', params: { d: { key: 'e.f' } } } } } }).success).toBe(false);
    expect(apply.safeParse({ ...base, labelRef: { key: 'editLabel.x', params: { a: 'y'.repeat(1001) } } }).success).toBe(false);
  });
});

describe('framingFromCrop', () => {
  type Size = { width: number; height: number };
  /** 画布上看到的那块（源的归一化 `[左, 上, 宽, 高]`），同 `render-graph` 的 `media_layer`。 */
  const visible = (crop: Crop | null, focal: FocalPoint | null, source: Size, canvas: Size) => {
    const c = crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const rw = 1 - c.left - c.right;
    const rh = 1 - c.top - c.bottom;
    const scale = Math.max(canvas.width / (rw * source.width), canvas.height / (rh * source.height)) * (focal?.zoom ?? 1);
    const u = canvas.width / (rw * source.width * scale);
    const v = canvas.height / (rh * source.height * scale);
    const { x, y } = focal ?? { x: 0.5, y: 0.5 };
    return [c.left + rw * (1 - u) * x, c.top + rh * (1 - v) * y, rw * u, rh * v];
  };
  const landscape = { width: 1920, height: 1080 };
  const portrait = { width: 1080, height: 1920 };
  const same = (a: number[], b: number[]) => a.forEach((n, i) => expect(n).toBeCloseTo(b[i]!, 3));

  it('横屏剪成竖屏的左右裁剪换成取景点，看到的不变', () => {
    const crop = { left: 0.3205, top: 0, right: 0.3631, bottom: 0 };
    const framing = framingFromCrop(crop, landscape, portrait)!;
    expect(framing.crop).toBeNull();
    expect(framing.focalPoint.y).toBe(0.5);
    expect(framing.focalPoint.x).toBeCloseTo(0.3205 / (1 - 0.3164), 3);
    same(visible(framing.crop, framing.focalPoint, landscape, portrait), visible(crop, null, landscape, portrait));
  });

  it('上下的裁剪（放大、去黑边）留着，只放开左右', () => {
    const crop = { left: 0.4, top: 0.1, right: 0.3, bottom: 0.15 };
    const framing = framingFromCrop(crop, landscape, portrait)!;
    expect(framing.crop?.left).toBe(0);
    expect(framing.crop?.right).toBe(0);
    expect(framing.crop!.top + framing.crop!.bottom).toBeCloseTo(0.25, 4);
    same(visible(framing.crop, framing.focalPoint, landscape, portrait), visible(crop, null, landscape, portrait));
  });

  it('竖屏源放开上下，原来的取景点也算进去', () => {
    const crop = { left: 0.05, top: 0.3, right: 0.05, bottom: 0.2 };
    const focal = { x: 0.5, y: 0.2 };
    const framing = framingFromCrop(crop, portrait, landscape, focal)!;
    expect(framing.crop?.top).toBe(0);
    expect(framing.crop?.bottom).toBe(0);
    expect(framing.focalPoint.x).toBe(0.5);
    same(visible(framing.crop, framing.focalPoint, portrait, landscape), visible(crop, focal, portrait, landscape));
  });

  it('原来的放大倍数算进看到的那块，换出来的取景点不再放大', () => {
    const focal = { x: 0.3, y: 0.5, zoom: 2 };
    const framing = framingFromCrop(null, landscape, portrait, focal)!;
    expect(framing.focalPoint.zoom).toBeUndefined();
    expect(framing.crop!.top + framing.crop!.bottom).toBeCloseTo(0.5, 4);
    same(visible(framing.crop, framing.focalPoint, landscape, portrait), visible(null, focal, landscape, portrait));
  });

  it('没有多出来的画面时取景点居中；尺寸不可用时 null', () => {
    expect(framingFromCrop(null, landscape, landscape)).toEqual({ crop: null, focalPoint: { x: 0.5, y: 0.5 } });
    expect(framingFromCrop(null, { width: 0, height: 1080 }, portrait)).toBeNull();
    expect(framingFromCrop({ left: 0.6, top: 0, right: 0.5, bottom: 0 }, landscape, portrait)).toBeNull();
  });
});

describe('panelRects', () => {
  const portrait = { width: 1080, height: 1920 };
  const square = { width: 1080, height: 1080 };

  it('不留间距时与一期的格子逐位相同', () => {
    expect(panelRects('rows', 2)).toEqual([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 0, y: 50, w: 100, h: 50 },
    ]);
    expect(panelRects('rows', 3)).toEqual([
      { x: 0, y: 0, w: 100, h: 33.333 },
      { x: 0, y: 33.333, w: 100, h: 33.334 },
      { x: 0, y: 66.667, w: 100, h: 33.333 },
    ]);
    expect(panelRects('grid', 4, 0, portrait)).toEqual([
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 50, y: 0, w: 50, h: 50 },
      { x: 0, y: 50, w: 50, h: 50 },
      { x: 50, y: 50, w: 50, h: 50 },
    ]);
    expect(panelRects('rows', 4)).toBeNull();
    expect(panelRects('spotlight', 2)).toBeNull();
  });

  it('上一下二：上格整宽，下面左右两格', () => {
    expect(panelRects('spotlight', 3)).toEqual([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 0, y: 50, w: 50, h: 50 },
      { x: 50, y: 50, w: 50, h: 50 },
    ]);
  });

  it('间距按画布短边算，横缝与竖缝像素相同，贴边不留', () => {
    expect(panelRects('rows', 3, 2, portrait)).toEqual([
      { x: 0, y: 0, w: 100, h: 32.583 },
      { x: 0, y: 33.708, w: 100, h: 32.584 },
      { x: 0, y: 67.417, w: 100, h: 32.583 },
    ]);
    const [top, left, right] = panelRects('spotlight', 3, 2, portrait)!;
    expect(right!.x - (left!.x + left!.w)).toBeCloseTo(2, 3);
    expect(((left!.y - top!.h) * portrait.height) / 100).toBeCloseTo((2 * portrait.width) / 100, 1);
    expect(right!.x + right!.w).toBe(100);
    expect(left!.y + left!.h).toBe(100);
    const grid = panelRects('grid', 4, 4, square)!;
    expect(grid[1]!.x - grid[0]!.w).toBeCloseTo(4, 3);
    expect(grid[2]!.y - grid[0]!.h).toBeCloseTo(4, 3);
    expect(panelRects('rows', 2, 99, portrait)).toEqual(panelRects('rows', 2, 10, portrait));
  });

  it('读回来认出原来的版式与间距', () => {
    for (const [layout, count] of [
      ['rows', 2],
      ['rows', 3],
      ['spotlight', 3],
      ['grid', 4],
    ] as const) {
      for (const gap of [0, 1.5, 2, 10]) {
        for (const canvas of [portrait, square]) {
          const panels = panelRects(layout, count, gap, canvas)!.map((rect) => ({ rect }));
          expect(panelLayoutOf(panels, canvas)).toEqual({ layout, gap });
        }
      }
    }
    expect(panelLayoutOf([{ rect: { x: 0, y: 0, w: 100, h: 40 } }, { rect: { x: 0, y: 60, w: 100, h: 40 } }], portrait)).toBeNull();
    expect(panelLayoutOf([{ rect: { x: 0, y: 0, w: 100, h: 50 } }])).toBeNull();
  });
});
