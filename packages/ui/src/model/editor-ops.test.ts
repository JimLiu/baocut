import { describe, expect, it } from 'vitest';
import type { AssetRecord, AudioItem, CaptionItem, CompositionItem, DocumentRecord, Sequence, Track, VideoItem } from '@baocut/protocol';
import {
  assetFilePath,
  assetUsages,
  audioAside,
  deletableItemIds,
  dubGroupCard,
  dubGroupIds,
  dubPlanRecord,
  importAndPlace,
  isPlaceable,
  itemsAtFrame,
  libraryAssets,
  moveOperation,
  nudgeDelta,
  placeAsset,
  splitOperations,
  trimBounds,
  trimOperation,
  usageCount,
} from './editor-ops.ts';

const fps = { num: 30, den: 1 };

function track(id: string, order: number, kind: Track['kind'], locked = false): Track {
  return { id, order, kind, locked, visible: true, muted: false, solo: { enabled: false, group: kind === 'audio' ? 'audio' : 'visual' } };
}

function video(id: string, trackId: string, fromFrame: number, durationFrames: number): VideoItem {
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
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 30 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
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

const clip: AssetRecord & { kind: 'video' } = {
  id: 'asset_v',
  kind: 'video',
  name: 'clip',
  currentRevision: '1',
  revisions: {
    '1': {
      revision: '1',
      contentHash: 'h',
      byteLength: 1,
      mediaType: 'video/mp4',
      storage: { mode: 'managed' },
      duration: { ticks: '2', timescale: 1 },
      provenance: { origin: 'import' },
    },
  },
};

describe('编辑操作', () => {
  it('添加到时间线：画面放在播放头处最上层之上的空轨，没有就新建一条；指定了轨道时占着就接在末尾', () => {
    const tracks = [track('v1', 0, 'visual'), track('a1', 1, 'audio'), track('v2', 2, 'visual')];
    const empty = sequence(tracks, []);
    expect(placeAsset(empty, clip, 15)).toMatchObject([{ type: 'addItem', trackId: 'v1', at: { unit: 'frames', value: 15 } }]);

    const busy = sequence(tracks, [video('x', 'v1', 0, 90)]);
    expect(placeAsset(busy, clip, 15)).toMatchObject([{ trackId: 'v2', at: { value: 15 } }]);

    // 上面那条在播放头处空着、下面那条占着：放上面。上面那条占着、下面空着：下面会被盖住，新建一条。
    const full = sequence(tracks, [video('x', 'v1', 0, 90), video('y', 'v2', 30, 30)]);
    const overlay = placeAsset(full, clip, 15);
    expect(overlay.map((op) => op.type)).toEqual(['addTrack', 'insertItems']);
    expect(overlay[0]).toMatchObject({ kind: 'visual', ref: 'place-track' });
    expect(overlay[1]).toMatchObject({
      items: [
        {
          type: 'video',
          trackRef: 'place-track',
          name: 'clip',
          span: { fromFrame: 15, durationFrames: 60 },
          place: {},
          mode: 'fullscreen',
          assetRef: { id: 'asset_v', revision: '1' },
          fit: 'contain',
          embeddedAudio: { enabled: true, volume: 1 },
        },
      ],
    });
    const topBusy = sequence(tracks, [video('y', 'v2', 0, 90)]);
    expect(placeAsset(topBusy, clip, 15).map((op) => op.type)).toEqual(['addTrack', 'insertItems']);

    const image = { ...clip, id: 'asset_i', kind: 'image' as const, name: 'sticker' };
    const still = placeAsset(full, image, 15);
    expect(still[1]).toMatchObject({ items: [{ type: 'image', span: { fromFrame: 15, durationFrames: 150 } }] });
    expect(still[1]).not.toHaveProperty('items.0.timeMap');

    const dropped = placeAsset(full, clip, 15, 'v1');
    expect(dropped).toMatchObject([{ trackId: 'v1' }]);
    expect(dropped[0]).not.toHaveProperty('at');

    const locked = sequence([track('v1', 0, 'visual', true), track('v2', 2, 'visual')], []);
    expect(placeAsset(locked, clip, 0)).toMatchObject([{ trackId: 'v2' }]);
  });

  it('拖进来的文件：导入与放置在同一笔事务，第一个放在落点', () => {
    const seq = sequence([track('v1', 0, 'visual'), track('a1', 1, 'audio')], []);
    const ops = importAndPlace(
      seq,
      [
        { path: '/a.mp4', kind: 'video' },
        { path: '/b.wav', kind: 'audio' },
        { path: '/c.txt', kind: null },
      ],
      45,
      'v1',
    );
    expect(ops.map((op) => op.type)).toEqual(['importAsset', 'addItem', 'importAsset', 'addItem', 'importAsset']);
    expect(ops[1]).toMatchObject({ asset: { ref: 'drop0' }, trackId: 'v1', at: { value: 45 } });
    // 音频不能进视觉轨道：交给引擎挑音频轨道，接在末尾。
    expect(ops[3]).toEqual({ type: 'addItem', sequenceId: 'seq', asset: { ref: 'drop1' }, alignment: 'exact-frame' });
    expect(ops[0]).toEqual({ type: 'importAsset', path: '/a.mp4', ref: 'drop0' });
  });

  it('导入方知道素材名与来源时一并带上', () => {
    const seq = sequence([track('v1', 0, 'visual')], []);
    const provenance = { origin: 'link-import', source: { url: 'https://example.com/v' } };
    const [op] = importAndPlace(seq, [{ path: '/d/访谈.mp4', kind: 'video', name: '访谈', provenance }], 0);
    expect(op).toEqual({ type: 'importAsset', path: '/d/访谈.mp4', ref: 'drop0', name: '访谈', provenance });
  });

  it('拖动：单个可以换轨道，多个一起平移', () => {
    const seq = sequence([track('v1', 0, 'visual'), track('v2', 2, 'visual')], [video('a', 'v1', 0, 30), video('b', 'v1', 60, 30)]);
    expect(moveOperation(seq, { itemId: 'a', itemIds: ['a'], deltaFrames: 0, trackId: 'v1' })).toBeNull();
    expect(moveOperation(seq, { itemId: 'a', itemIds: ['a'], deltaFrames: 10, trackId: 'v2' })).toMatchObject({
      type: 'moveItem',
      at: { value: 10 },
      trackId: 'v2',
    });
    expect(moveOperation(seq, { itemId: 'a', itemIds: ['a', 'b'], deltaFrames: -5, trackId: 'v2' })).toMatchObject({
      type: 'moveItems',
      moves: [
        { itemId: 'a', at: { value: 0 } },
        { itemId: 'b', at: { value: 55 } },
      ],
    });
  });

  it('裁切至少留一帧；没变就不提交', () => {
    const seq = sequence([track('v1', 0, 'visual')], [video('a', 'v1', 30, 30)]);
    const item = seq.items[0]!;
    expect(trimOperation(seq, item, 'start', 60)).toBeNull();
    expect(trimOperation(seq, item, 'start', 30)).toBeNull();
    expect(trimOperation(seq, item, 'start', 40)).toMatchObject({ edge: 'start', at: { value: 40 } });
    expect(trimOperation(seq, item, 'end', 30)).toBeNull();
    expect(trimOperation(seq, item, 'end', 50)).toMatchObject({ edge: 'end', at: { value: 50 } });
  });

  it('字幕与合成实例走同样的移动、裁切与拆分；代码包素材不能直接放上时间线', () => {
    const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };
    const caption: CaptionItem = {
      ...base,
      id: 'c',
      trackId: 's1',
      type: 'caption',
      span: { fromFrame: 30, durationFrames: 60 },
      documentId: 'doc',
    };
    const composition: CompositionItem = {
      ...base,
      id: 'k',
      trackId: 'v1',
      type: 'composition',
      span: { fromFrame: 30, durationFrames: 30 },
      place: {},
      source: { kind: 'bundle', assetRef: { id: 'asset_b', revision: '1' } },
      parameterValues: {},
      timeMap: { kind: 'linear', sourceIn: { ticks: '15', timescale: 30 }, rate: { num: 1, den: 1 } },
    };
    const bundle: AssetRecord = { ...clip, id: 'asset_b', kind: 'bundle', name: '片头' };
    const assets = { asset_v: clip, asset_b: bundle };
    const seq = sequence([track('v1', 0, 'visual'), track('s1', 1, 'subtitle')], [composition, caption]);

    expect(moveOperation(seq, { itemId: 'c', itemIds: ['c'], deltaFrames: 15, trackId: null })).toMatchObject({
      type: 'moveItem',
      at: { value: 45 },
    });
    expect(trimOperation(seq, caption, 'end', 120)).toMatchObject({ edge: 'end', at: { value: 120 } });
    expect(splitOperations(seq, [], 45).map((op) => 'itemId' in op && op.itemId)).toEqual(['k', 'c']);

    // 字幕没有源时间：两端都不受限。
    expect(trimBounds(caption, assets, seq)).toEqual({ min: 0, max: Number.POSITIVE_INFINITY });
    // 合成的开头不能早于源时间 0（入点 0.5 秒 → 最多往前 15 帧）；代码包没有时长，结尾不受限。
    expect(trimBounds(composition, assets, seq)).toEqual({ min: 15, max: Number.POSITIVE_INFINITY });
    // 有预渲染替身时，结尾受替身的长度限制（2 秒的替身，入点 0.5 秒 → 还能放 45 帧）。
    const prerendered = { ...composition, prerender: { id: 'asset_v', revision: '1' } };
    expect(trimBounds(prerendered, assets, seq)).toEqual({ min: 15, max: 75 });

    expect(usageCount(seq, 'asset_b')).toBe(1);
    expect(usageCount(sequence(seq.tracks, [prerendered]), 'asset_v')).toBe(1);
    expect(usageCount(seq, 'asset_v')).toBe(0);
    expect(isPlaceable(bundle)).toBe(false);
  });

  it('素材库按类别分页，每页按名字排', () => {
    const asset = (id: string, kind: AssetRecord['kind'], name: string) =>
      ({ id, kind, name, currentRevision: '1', revisions: {} }) as AssetRecord;
    const assets = {
      v2: asset('v2', 'video', '乙.mp4'),
      a1: asset('a1', 'audio', '配乐.m4a'),
      v1: asset('v1', 'video', '甲.mp4'),
      b1: asset('b1', 'bundle', '片头'),
    };
    expect(libraryAssets(assets, 'video').map((a) => a.id)).toEqual(['v1', 'v2']);
    expect(libraryAssets(assets, 'audio').map((a) => a.id)).toEqual(['a1']);
    expect(libraryAssets(assets, 'image')).toEqual([]);
  });

  it('拆分：选中的优先；没选中时拆所有跨过播放头且没锁定的', () => {
    const seq = sequence(
      [track('v1', 0, 'visual'), track('v2', 2, 'visual', true)],
      [video('a', 'v1', 0, 60), video('b', 'v2', 0, 60), video('c', 'v1', 60, 30)],
    );
    expect(splitOperations(seq, [], 30).map((op) => 'itemId' in op && op.itemId)).toEqual(['a']);
    expect(splitOperations(seq, ['c'], 30)).toEqual([]);
    expect(splitOperations(seq, [], 60)).toEqual([]);
  });
});

describe('删除选中（Delete 键、走带、检查器与右键菜单）', () => {
  it('删的是选区里还在时间线上的片段；锁住的照样交给引擎判，选区里过时的 ID 不算', () => {
    const seq = sequence([track('v1', 0, 'visual'), track('v2', 1, 'visual', true)], [video('a', 'v1', 0, 30), video('b', 'v2', 0, 30)]);
    expect(deletableItemIds(seq, [])).toEqual([]);
    expect(deletableItemIds(seq, ['gone'])).toEqual([]);
    expect(deletableItemIds(seq, ['b', 'gone', 'a'])).toEqual(['a', 'b']);
  });
});

describe('播放头下的片段（⌘A）', () => {
  it('时段覆盖播放头那一帧的（终点那一帧不算）', () => {
    const seq = sequence([track('v1', 0, 'visual'), track('v2', 1, 'visual')], [video('a', 'v1', 0, 30), video('b', 'v2', 20, 30)]);
    expect(itemsAtFrame(seq, 25)).toEqual(['a', 'b']);
    expect(itemsAtFrame(seq, 30)).toEqual(['b']);
    expect(itemsAtFrame(seq, 50)).toEqual([]);
  });
});

describe('微调时间（⌥←/→）', () => {
  const seq = sequence(
    [track('v1', 0, 'visual'), track('v2', 1, 'visual', true)],
    [video('a', 'v1', 10, 20), video('b', 'v1', 40, 20), video('c', 'v2', 0, 20)],
  );
  it('累计偏移：不越过 0，不撞到同轨道没选中的片段', () => {
    expect(nudgeDelta(seq, ['a'], 0, 5)).toBe(5);
    expect(nudgeDelta(seq, ['a'], 5, 5)).toBe(10);
    expect(nudgeDelta(seq, ['a'], 10, 1)).toBe(10);
    expect(nudgeDelta(seq, ['a'], 0, -10)).toBe(-10);
    expect(nudgeDelta(seq, ['a'], -10, -1)).toBe(-10);
  });
  it('一起选中的片段互不阻挡；锁住的不动', () => {
    expect(nudgeDelta(seq, ['a', 'b'], 0, 30)).toBe(30);
    expect(nudgeDelta(seq, ['c'], 0, 5)).toBe(0);
  });
});

describe('素材菜单：用在哪、在文件夹中显示', () => {
  it('按起点排，带时间线行头上的轨道名', () => {
    const seq = sequence(
      [track('v1', 0, 'visual'), { ...track('v2', 1, 'visual'), name: 'B-roll' }],
      [{ ...video('b', 'v2', 60, 30), name: '桌面' }, video('a', 'v1', 0, 30), { ...video('c', 'v1', 90, 15), assetRef: { id: 'other', revision: '1' } }],
    );
    expect(assetUsages(seq, 'asset_v')).toEqual([
      { itemId: 'a', track: '画面 1', name: '', start: 0, end: 1 },
      { itemId: 'b', track: '画面 · B-roll', name: '桌面', start: 2, end: 3 },
    ]);
    expect(assetUsages(null, 'asset_v')).toEqual([]);
  });

  it('链接的素材给原文件（相对路径接在视频目录后）；收进视频目录的没有单独的位置', () => {
    const linked = (path: string): AssetRecord => ({
      ...clip,
      revisions: { '1': { ...clip.revisions['1']!, storage: { mode: 'linked', locator: { path }, frozen: false } } },
    });
    expect(assetFilePath(linked('/Users/me/a.mp4'), '/v/demo')).toBe('/Users/me/a.mp4');
    expect(assetFilePath(linked('media/a.mp4'), '/v/demo/')).toBe('/v/demo/media/a.mp4');
    expect(assetFilePath(linked('media\\a.mp4'), 'C:\\v\\demo')).toBe('C:\\v\\demo\\media\\a.mp4');
    expect(assetFilePath(linked('media/a.mp4'), null)).toBeNull();
    expect(assetFilePath(clip, '/v/demo')).toBeNull();
  });
});

describe('音频页的配音组', () => {
  const dubAsset = (id: string, name: string, extra: Record<string, unknown>, seconds = 2): AssetRecord => ({
    id,
    kind: 'audio',
    name,
    currentRevision: '1',
    revisions: {
      '1': {
        revision: '1',
        contentHash: id,
        byteLength: 1,
        mediaType: 'audio/wav',
        storage: { mode: 'managed' },
        duration: { ticks: String(seconds), timescale: 1 },
        provenance: { origin: 'generated', source: { pipeline: 'dub', jobId: 'job_7', ...extra } },
      },
    },
  });
  const voice = (id: string, trackId: string, assetId: string, fromFrame: number, mark: Record<string, unknown> | null, muted = false): AudioItem => ({
    id,
    trackId,
    type: 'audio',
    enabled: true,
    locked: false,
    paintOrder: 0,
    followPolicy: { kind: 'sequence-fixed' },
    assetRef: { id: assetId, revision: '1' },
    fromFrame,
    subframeOffset: { ticks: '0', timescale: 1 },
    playDuration: { ticks: '3', timescale: 2 },
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
    mix: { volume: 1, ...(muted ? { muted: true } : {}) },
    ...(mark ? { role: 'dub', extensions: { 'baocut.dub': mark } } : {}),
  });
  const assets: Record<string, AssetRecord> = {
    s1: dubAsset('s1', '配音（en）第 1 句', { language: 'en', unitId: 'u1' }),
    s2: dubAsset('s2', '配音（en）第 2 句', { language: 'en', unitId: 'u2' }),
    bg: dubAsset('bg', '背景（分离）', { capability: 'separateAudio', stem: 'background' }, 60),
    song: { ...clip, id: 'song', kind: 'audio', name: 'song.mp3' },
  };
  const seq = sequence(
    [track('a1', 0, 'audio'), track('a2', 1, 'audio'), track('a3', 2, 'audio')],
    [
      voice('d2', 'a1', 's2', 90, { groupId: 'dub_7', language: 'en', unitId: 'u2' }, true),
      voice('d1', 'a1', 's1', 30, { groupId: 'dub_7', language: 'en', unitId: 'u1' }),
      voice('b1', 'a2', 'bg', 0, { groupId: 'dub_7', stem: 'background' }),
      voice('m', 'a3', 'song', 0, null),
    ],
  );
  const plan = {
    units: [
      { id: 'd-u1', status: 'ready', script: { text: 'Hello there.' }, extensions: { 'baocut.dub': { translationUnitId: 'u1' } } },
      { id: 'd-u2', status: 'ready', script: { text: 'Second line.' }, extensions: { 'baocut.dub': { translationUnitId: 'u2' } } },
      { id: 'd-u3', status: 'failed', script: { text: 'Lost one.' }, extensions: { 'baocut.dub': { translationUnitId: 'u3' } } },
      { id: 'd-u4', status: 'stale', script: null, extensions: { 'baocut.dub': { translationUnitId: 'u4' } } },
    ],
    extensions: { 'baocut.dub': { voice: { providerId: 'local', modelId: 'Qwen3-TTS', voice: 'v' }, mutedItemIds: ['orig'] } },
  };

  it('时间线上的配音实例与配音流程生成的素材归到一组，其余音频平铺', () => {
    const { groups, loose } = dubGroupIds(seq, Object.values(assets));
    expect(groups).toEqual(['dub_7']);
    expect(loose.map((a) => a.id)).toEqual(['song']);
  });

  it('组卡：背景一行、每句一行（按时间排、带译文），没合成与过期的句也列出来；副题照设计稿', () => {
    const card = dubGroupCard(seq, assets, 'dub_7', plan);
    expect(card).toMatchObject({ groupId: 'dub_7', language: 'en', badge: 'EN', title: '配音 · English', state: 'on', trackId: 'a1', regen: 1 });
    expect([...card.itemIds].sort()).toEqual(['b1', 'd1', 'd2']);
    expect(card.files.map((f) => [f.kind, f.itemId, f.name, f.text, f.status, f.muted, f.seconds])).toEqual([
      ['bed', 'b1', '背景（分离）', '分离出来的背景声', null, false, 60],
      ['sentence', 'd1', '第 1 句', 'Hello there.', null, false, 1.5],
      ['sentence', 'd2', '第 2 句', 'Second line.', null, true, 1.5],
      ['sentence', null, '第 3 句', 'Lost one.', 'failed', false, null],
      ['sentence', null, '第 4 句', '', 'stale', false, null],
    ]);
    expect(card.line).toBe('3 个文件 · 4 句 · 1 句没合成 · 1 句译文过期 · 1 句静音 · Qwen3-TTS');
  });

  it('计划还没取到时按实例列；轨道静音是「轨已关」，实例都删了是「不在时间线」', () => {
    const early = dubGroupCard(seq, assets, 'dub_7', undefined);
    expect(early.line).toBe('3 个文件 · 2 句 · 1 句静音');
    expect(early.files.filter((f) => f.kind === 'sentence').map((f) => f.name)).toEqual(['配音（en）第 1 句', '配音（en）第 2 句']);
    const off = dubGroupCard({ ...seq, tracks: seq.tracks.map((t) => (t.id === 'a1' ? { ...t, muted: true } : t)) }, assets, 'dub_7', plan);
    expect(off.state).toBe('off');
    const gone = dubGroupCard({ ...seq, items: seq.items.filter((i) => i.id === 'm') }, assets, 'dub_7', plan);
    expect(gone).toMatchObject({ state: 'gone', trackId: null, itemIds: [], language: 'en' });
    expect(gone.files[0]).toMatchObject({ kind: 'bed', itemId: null, seconds: 60 });
  });

  it('配音计划按概要里的 groupId 找；段头旁注照设计稿', () => {
    const record = (id: string, kind: string, groupId: string): DocumentRecord => ({
      id,
      kind,
      name: id,
      currentRevision: 'r',
      revisions: { r: { revision: 'r', contentHash: '', byteLength: 0, createdAt: '', createdBy: 't', summary: { groupId } } },
    });
    const documents = { a: record('a', 'translation', 'dub_7'), b: record('b', 'dubbing-plan', 'dub_8'), c: record('c', 'dubbing-plan', 'dub_7') };
    expect(dubPlanRecord(documents, 'dub_7')?.id).toBe('c');
    expect(dubPlanRecord(documents, 'dub_9')).toBeUndefined();
    expect(audioAside(2, 65)).toBe('2 组配音 · 65 个文件');
    expect(audioAside(0, 2)).toBe('2 个文件');
  });
});
