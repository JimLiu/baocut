import { describe, expect, it } from 'vitest';
import type { AssetRecord, AudioItem, CaptionItem, EditOperation, Sequence, SequenceItem, Track, VideoItem } from '@baocut/protocol';
import { describeReplace, planAssetReplace, REPLACE_IMPORT_REF, type AssetReplacePlan } from './asset-replace.ts';

// 用例照设计稿 model-video-replace.test.js：主轨拆成三段 a / b / c，另一条轨道上一段 B-roll。帧率 30。
const fps = { num: 30, den: 1 };
const f = (seconds: number) => Math.round(seconds * 30);

function track(id: string, kind: Track['kind'], locked = false): Track {
  return { id, order: 1, kind, locked, visible: true, muted: false, solo: { enabled: false, group: kind === 'audio' ? 'audio' : 'visual' } };
}

function clip(id: string, trackId: string, assetId: string, start: number, end: number, srcStart = 0, rate = 1): VideoItem {
  return {
    id,
    trackId,
    type: 'video',
    name: `${id}.mp4`,
    enabled: true,
    locked: false,
    paintOrder: 3,
    followPolicy: { kind: 'sequence-fixed' },
    span: { fromFrame: f(start), durationFrames: f(end) - f(start) },
    place: { x: 45, y: 10, w: 50, opacity: 0.8 },
    mode: 'pip',
    assetRef: { id: assetId, revision: 'r1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: String(f(srcStart)), timescale: 30 }, rate: { num: rate, den: 1 } },
    fit: 'cover',
    crop: { left: 0.1, top: 0, right: 0, bottom: 0 },
    embeddedAudio: { enabled: false, volume: 0.7 },
    role: 'b-roll',
    extensions: { 'x.test': { keep: true } },
  };
}

function asset(id: string, kind: AssetRecord['kind'], seconds: number | null, name = `${id}.mp4`): AssetRecord {
  return {
    id,
    kind,
    name,
    currentRevision: 'r1',
    revisions: {
      r1: {
        revision: 'r1',
        contentHash: id,
        byteLength: 1,
        mediaType: 'video/mp4',
        storage: { mode: 'managed' },
        ...(seconds === null ? {} : { duration: { ticks: String(Math.round(seconds * 1000)), timescale: 1000 } }),
        provenance: { origin: 'imported' },
      },
    } as AssetRecord['revisions'],
  };
}

function sequence(items: SequenceItem[], tracks: Track[] = [track('v1', 'visual'), track('v2', 'visual')]): Sequence {
  return {
    id: 'seq',
    revision: 'r',
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

const lane = () => [
  clip('a', 'v1', 'first', 0, 28),
  clip('b', 'v1', 'main', 28, 45.2, 28),
  clip('c', 'v1', 'last', 45.2, 78, 45.2),
  clip('broll', 'v2', 'desk', 5, 15),
];

const ok = (plan: AssetReplacePlan) => {
  if (!plan.ok) throw new Error(plan.reason);
  return plan;
};
const op = <T extends EditOperation['type']>(plan: AssetReplacePlan, type: T) =>
  ok(plan).operations.find((o): o is Extract<EditOperation, { type: T }> => o.type === type);
const ops = <T extends EditOperation['type']>(plan: AssetReplacePlan, type: T) =>
  ok(plan).operations.filter((o): o is Extract<EditOperation, { type: T }> => o.type === type);
const types = (plan: AssetReplacePlan) => ok(plan).operations.map((o) => o.type);
const restart = (timescale = 30, rate = 1) => ({ kind: 'linear', sourceIn: { ticks: '0', timescale }, rate: { num: rate, den: 1 } });

describe('planAssetReplace', () => {
  it('新素材从 0 秒起；够长时片段长度不变，原地换素材，实例与其余字段不动（设计稿「直接替换」）', () => {
    const seq = sequence([clip('v', 'v1', 'old', 10, 20, 30, 2)]);
    const plan = ok(planAssetReplace({ sequence: seq, asset: asset('old', 'video', 100), source: { from: 'library', asset: asset('new', 'video', 24) } }));
    expect(plan.replaced).toEqual([expect.objectContaining({ itemId: 'v', start: 10, end: 20, newStart: 10, newEnd: 20, delta: 0, aligned: false })]);
    // 只有一条 replaceItemAsset：不删不写回，ID、摆位、裁剪、效果、关键帧都留在实例上。
    expect(plan.operations).toEqual([
      { type: 'replaceItemAsset', sequenceId: 'seq', itemId: 'v', assetRef: { id: 'new', revision: 'r1' }, timeMap: restart(30, 2) },
    ]);
    expect(describeReplace(plan)).toBe('新素材够长，片段长度不变，时间线不变。');
    // 更长的新素材不把片段拉长（素材库这一层的偏离，见模型说明）。
    const longer = ok(planAssetReplace({ sequence: seq, asset: asset('old', 'video', 100), source: { from: 'library', asset: asset('new', 'video', 60) } }));
    expect(longer.replaced[0]!.delta).toBe(0);
  });

  it('新素材不够长：先收短终点（按速度换算）再换，这条轨道只有它时轨道跟着变短；淡变放不下时收进新长度', () => {
    const v = { ...clip('v', 'v1', 'old', 10, 20, 30, 2), embeddedAudio: { enabled: true, volume: 1, fadeIn: { ticks: '2', timescale: 1 }, fadeOut: { ticks: '2', timescale: 1 } } };
    const plan = ok(planAssetReplace({ sequence: sequence([v]), asset: asset('old', 'video', 100), source: { from: 'library', asset: asset('new', 'video', 6) } }));
    // 设计稿：dur 6、速度 2 → 新长 3 秒，终点 13，短 7 秒。
    expect(plan.replaced[0]).toMatchObject({ newEnd: 13, delta: -7 });
    expect(types(plan)).toEqual(['trimItem', 'replaceItemAsset', 'setAudioMix']);
    expect(op(plan, 'trimItem')).toEqual({ type: 'trimItem', sequenceId: 'seq', itemId: 'v', edge: 'end', at: { unit: 'frames', value: 390 }, alignment: 'exact-frame' });
    expect(op(plan, 'replaceItemAsset')!.timeMap).toEqual(restart(30, 2));
    // 淡出 2 秒留着，淡入收到剩下的 1 秒。
    expect(op(plan, 'setAudioMix')).toEqual({ type: 'setAudioMix', sequenceId: 'seq', itemId: 'v', fadeIn: '1' });
    expect(describeReplace(plan)).toBe('片段会变短 7.0 秒，这条轨道跟着变短。');
  });

  it('同轨 ripple：变短把后面的片段往前拉；别的轨道不动（设计稿「同轨 ripple」）', () => {
    const seq = sequence(lane());
    const plan = ok(planAssetReplace({ sequence: seq, asset: asset('main', 'video', 206), source: { from: 'library', asset: asset('x', 'video', 7.2) } }));
    expect(plan.replaced[0]).toMatchObject({ itemId: 'b', start: 28, end: 45.2, newEnd: 35.2, delta: expect.closeTo(-10, 6) });
    expect(op(plan, 'trimItem')!.at).toEqual({ unit: 'frames', value: f(35.2) });
    expect(op(plan, 'moveItems')!.moves).toEqual([{ itemId: 'c', offset: { unit: 'frames', value: -300 } }]);
    expect(plan.moved).toBe(1);
    expect(describeReplace(plan)).toBe('片段会变短 10.0 秒，同轨后面 1 段往前挪。');
    // B-roll 自己一条轨道：只改自己。
    const broll = ok(planAssetReplace({ sequence: seq, asset: asset('desk', 'video', 30), source: { from: 'library', asset: asset('x', 'video', 4) } }));
    expect(broll.moved).toBe(0);
    expect(broll.replaced[0]).toMatchObject({ itemId: 'broll', newEnd: 9 });
    expect(describeReplace(broll)).toBe('片段会变短 6.0 秒，这条轨道跟着变短。');
  });

  it('一个素材用了几段：一起换，各段从 0 秒起，前面变短的累计挪后面的起点（换掉的片段自己也挪）', () => {
    const seq = sequence([
      clip('a', 'v1', 'main', 0, 28),
      clip('b', 'v1', 'main', 28, 45.2, 28),
      clip('c', 'v1', 'main', 45.2, 78, 45.2),
      clip('d', 'v1', 'other', 80, 90),
    ]);
    const plan = ok(planAssetReplace({ sequence: seq, asset: asset('main', 'video', 206), source: { from: 'library', asset: asset('x', 'video', 20) } }));
    expect(plan.replaced.map((r) => [r.itemId, r.newStart, +r.newEnd.toFixed(3)])).toEqual([
      ['a', 0, 20],
      ['b', 20, 37.2],
      ['c', 37.2, 57.2],
    ]);
    expect(ops(plan, 'replaceItemAsset').map((o) => o.itemId)).toEqual(['a', 'b', 'c']);
    // a、c 在原位收短；b 跟着 a 短的 8 秒、c 也跟着往前；d 跟着 a、c 一共短的 20.8 秒往前。
    expect(ops(plan, 'trimItem').map((o) => [o.itemId, o.at])).toEqual([
      ['a', { unit: 'frames', value: 600 }],
      ['c', { unit: 'frames', value: f(45.2) + 600 }],
    ]);
    expect(op(plan, 'moveItems')!.moves).toEqual([
      { itemId: 'b', offset: { unit: 'frames', value: -240 } },
      { itemId: 'c', offset: { unit: 'frames', value: -240 } },
      { itemId: 'd', offset: { unit: 'frames', value: -624 } },
    ]);
    expect(describeReplace(plan)).toBe('2 段会变短，一共短 20.8 秒，同轨后面 1 段往前挪。');
    // 操作顺序：收短 → 挪（重叠在整笔之后检查）→ 换素材。
    expect(types(plan)).toEqual(['trimItem', 'trimItem', 'moveItems', 'replaceItemAsset', 'replaceItemAsset', 'replaceItemAsset']);
  });

  it('只换一段（画布工具条的 itemId）：用同一素材的别的片段不换，同轨在它后面的照样跟着挪', () => {
    const seq = sequence([
      clip('a', 'v1', 'main', 0, 28),
      clip('b', 'v1', 'main', 28, 45.2, 28),
      clip('c', 'v1', 'main', 45.2, 78, 45.2),
      clip('d', 'v1', 'other', 80, 90),
    ]);
    const main = asset('main', 'video', 206);
    const plan = ok(planAssetReplace({ sequence: seq, asset: main, source: { from: 'library', asset: asset('x', 'video', 10) }, itemId: 'b' }));
    expect(plan.replaced.map((r) => [r.itemId, r.newStart, +r.newEnd.toFixed(3)])).toEqual([['b', 28, 38]]);
    expect(ops(plan, 'replaceItemAsset').map((o) => o.itemId)).toEqual(['b']);
    // b 从 17.2 秒变成 10 秒：c（同一素材，没换）与 d 都往前 7.2 秒。
    expect(op(plan, 'moveItems')!.moves).toEqual([
      { itemId: 'c', offset: { unit: 'frames', value: -216 } },
      { itemId: 'd', offset: { unit: 'frames', value: -216 } },
    ]);
    const locked = sequence([{ ...clip('b', 'v1', 'main', 28, 45.2, 28), locked: true }]);
    const refused = planAssetReplace({ sequence: locked, asset: main, source: { from: 'library', asset: asset('x', 'video', 10) }, itemId: 'b' });
    expect(refused).toEqual({ ok: false, reason: '这一段锁着，先解锁再换。' });
  });

  it('按原素材时间对齐：原来取用的那一段放得下就照旧，放不下按普通替换（设计稿「同源成片」）', () => {
    const seq = sequence(lane());
    const covered = ok(
      planAssetReplace({ sequence: seq, asset: asset('main', 'video', 206), source: { from: 'library', asset: asset('x', 'video', 50) }, align: true }),
    );
    expect(covered.replaced[0]).toMatchObject({ aligned: true, delta: 0 });
    // 时间映射不改：不带 timeMap。
    expect(covered.operations).toEqual([{ type: 'replaceItemAsset', sequenceId: 'seq', itemId: 'b', assetRef: { id: 'x', revision: 'r1' } }]);
    const partial = ok(
      planAssetReplace({ sequence: seq, asset: asset('last', 'video', 206), source: { from: 'library', asset: asset('x', 'video', 50) }, align: true }),
    );
    expect(partial.replaced[0]).toMatchObject({ itemId: 'c', aligned: false, delta: 0 });
    expect(op(partial, 'replaceItemAsset')!.timeMap).toEqual(restart());
  });

  it('拒绝的只有真问题：类别不同、同一个素材、没用到、都锁着、新素材不到一帧', () => {
    const seq = sequence(lane());
    const base = { sequence: seq, asset: asset('main', 'video', 206) };
    expect(planAssetReplace({ ...base, source: { from: 'library', asset: asset('song', 'audio', 30) } })).toEqual({
      ok: false,
      reason: '只能换成同一类的素材：这里要一份视频。',
    });
    expect(planAssetReplace({ ...base, source: { from: 'library', asset: asset('main', 'video', 206) } }).ok).toBe(false);
    expect(planAssetReplace({ ...base, asset: asset('unused', 'video', 10), source: { from: 'library', asset: asset('x', 'video', 9) } })).toEqual({
      ok: false,
      reason: '时间线上没有用到这个素材，不用替换。',
    });
    expect(planAssetReplace({ ...base, source: { from: 'library', asset: asset('x', 'video', 0.01) } })).toEqual({
      ok: false,
      reason: '新素材太短，放不下一帧。',
    });
    const locked = sequence([{ ...clip('b', 'v1', 'main', 28, 45.2), locked: true }]);
    expect(planAssetReplace({ ...base, sequence: locked, source: { from: 'library', asset: asset('x', 'video', 9) } }).ok).toBe(false);
  });

  it('锁着的片段与锁着的轨道保持原样；同轨的波纹到锁着的片段为止', () => {
    const items = [
      clip('a', 'v1', 'main', 0, 10),
      { ...clip('b', 'v1', 'other', 10, 20), locked: true },
      clip('c', 'v1', 'other', 20, 30),
      clip('d', 'v2', 'main', 0, 10),
    ];
    const plan = ok(
      planAssetReplace({
        sequence: sequence(items, [track('v1', 'visual'), track('v2', 'visual', true)]),
        asset: asset('main', 'video', 60),
        source: { from: 'library', asset: asset('x', 'video', 4) },
      }),
    );
    expect(plan.replaced.map((r) => r.itemId)).toEqual(['a']);
    expect(plan.kept).toEqual([{ itemId: 'd', name: 'd.mp4', start: 0, end: 10, reason: 'locked' }]);
    expect(op(plan, 'moveItems')).toBeUndefined();
  });

  it('本地文件：同一笔事务里先导入，换上导入的 ref；时长未知先保留原时长（设计稿 keep）', () => {
    const seq = sequence(lane());
    const plan = ok(
      planAssetReplace({
        sequence: seq,
        asset: asset('main', 'video', 206),
        source: { from: 'file', path: '/Users/me/new.mov', name: 'new.mov', kind: 'video' },
      }),
    );
    expect(plan.durationKnown).toBe(false);
    expect(plan.operations).toEqual([
      { type: 'importAsset', path: '/Users/me/new.mov', ref: REPLACE_IMPORT_REF },
      { type: 'replaceItemAsset', sequenceId: 'seq', itemId: 'b', assetImportRef: REPLACE_IMPORT_REF, timeMap: restart() },
    ]);
    expect(describeReplace(plan)).toBe('素材时长未知，先保留片段原时长。');
    expect(
      planAssetReplace({ sequence: seq, asset: asset('main', 'video', 206), source: { from: 'file', path: '/a.mp3', name: 'a.mp3', kind: 'audio' } }).ok,
    ).toBe(false);
  });

  it('片段名还是旧素材名（放上来时的默认名）就跟着换成新素材名；改过名的保留', () => {
    const named = { ...clip('x', 'v1', 'old', 0, 10), name: 'old.mp4' };
    const renamed = { ...clip('y', 'v1', 'old', 10, 20), name: '开场' };
    const seq = sequence([named, renamed]);
    const fromLibrary = ok(
      planAssetReplace({ sequence: seq, asset: asset('old', 'video', 100), source: { from: 'library', asset: asset('new', 'video', 100) } }),
    );
    expect(ops(fromLibrary, 'updateItem')).toEqual([{ type: 'updateItem', sequenceId: 'seq', itemId: 'x', name: 'new.mp4' }]);
    const fromFile = ok(
      planAssetReplace({
        sequence: seq,
        asset: asset('old', 'video', 100),
        source: { from: 'file', path: '/Users/me/new.mov', name: 'new.mov', kind: 'video' },
      }),
    );
    expect(ops(fromFile, 'updateItem')).toEqual([{ type: 'updateItem', sequenceId: 'seq', itemId: 'x', name: 'new.mov' }]);
  });

  it('音频：终点收到帧上，淡入淡出收进新长度（包络由引擎随收短换算），同轨后面的音频按帧挪', () => {
    const voice = (id: string, assetId: string, fromFrame: number, samples: number, offset = { ticks: '0', timescale: 1 }): AudioItem => ({
      id,
      trackId: 'a1',
      type: 'audio',
      enabled: true,
      locked: false,
      paintOrder: 1,
      followPolicy: { kind: 'sequence-fixed' },
      assetRef: { id: assetId, revision: 'r1' },
      fromFrame,
      subframeOffset: offset,
      playDuration: { ticks: String(samples), timescale: 48000 },
      timeMap: { kind: 'linear', sourceIn: { ticks: '24000', timescale: 48000 }, rate: { num: 1, den: 1 } },
      mix: {
        volume: 0.5,
        fadeIn: { ticks: '1', timescale: 1 },
        fadeOut: { ticks: '2', timescale: 1 },
        envelope: [
          { at: { ticks: '1', timescale: 2 }, volume: 0.7, ease: 'linear' },
          { at: { ticks: '4', timescale: 1 }, volume: 1, ease: 'linear' },
        ],
      },
    });
    const song = { from: 'library' as const, asset: asset('song', 'audio', 2.51) };
    const seq = sequence([voice('m', 'music', 0, 48000 * 5), voice('n', 'other', 150, 48000)], [track('a1', 'audio')]);
    const plan = ok(planAssetReplace({ sequence: seq, asset: asset('music', 'audio', 60), source: song }));
    // 5 秒 → 2.51 秒放不下：终点收到第 75 帧（2.5 秒），短 75 帧。
    expect(types(plan)).toEqual(['trimItem', 'moveItems', 'replaceItemAsset', 'setAudioMix']);
    expect(op(plan, 'trimItem')!.at).toEqual({ unit: 'frames', value: 75 });
    expect(op(plan, 'replaceItemAsset')!.timeMap).toEqual(restart(48000));
    expect(op(plan, 'setAudioMix')).toEqual({ type: 'setAudioMix', sequenceId: 'seq', itemId: 'm', fadeIn: '0.5' });
    expect(op(plan, 'moveItems')!.moves).toEqual([{ itemId: 'n', offset: { unit: 'frames', value: -75 } }]);
    expect(plan.replaced[0]).toMatchObject({ newEnd: 2.5, delta: -2.5 });

    // 起点不在帧上（0.01 秒）：终点仍收到帧上，后面的只挪整帧，留下不到一帧的缝、不重叠。
    const late = sequence([voice('m', 'music', 0, 48000 * 5, { ticks: '1', timescale: 100 }), voice('n', 'other', 151, 48000)], [track('a1', 'audio')]);
    const shifted = ok(planAssetReplace({ sequence: late, asset: asset('music', 'audio', 60), source: song }));
    expect(op(shifted, 'trimItem')!.at).toEqual({ unit: 'frames', value: 75 });
    expect(op(shifted, 'moveItems')!.moves).toEqual([{ itemId: 'n', offset: { unit: 'frames', value: -75 } }]);
    expect(shifted.replaced[0]!.delta).toBeCloseTo(-2.51, 9);
  });

  it('原地换：挂在片段上的转场、按它投影的字幕、指着它的闪避都不用动，不删也不写回', () => {
    const items: SequenceItem[] = [
      ...lane(),
      {
        id: 'cap',
        trackId: 's1',
        type: 'caption',
        enabled: true,
        locked: false,
        paintOrder: 1,
        followPolicy: { kind: 'sequence-fixed' },
        span: { fromFrame: 0, durationFrames: 100 },
        documentId: 'doc',
        scopeItemIds: ['a', 'b'],
      } satisfies CaptionItem,
    ];
    const seq: Sequence = {
      ...sequence(items),
      transitions: [
        { id: 't', leftItemId: 'a', rightItemId: 'b', kind: 'dissolve', durationFrames: 10, easing: 'linear', placement: 'center' },
      ],
      ducking: [
        {
          id: 'd',
          enabled: true,
          trigger: { kind: 'items', trackIds: ['v2'] },
          target: { itemIds: ['b'] },
          depth: 12,
          attack: { ticks: '0', timescale: 1 },
          release: { ticks: '0', timescale: 1 },
        },
      ],
    };
    const plan = ok(planAssetReplace({ sequence: seq, asset: asset('main', 'video', 206), source: { from: 'library', asset: asset('x', 'video', 50) } }));
    expect(types(plan)).toEqual(['replaceItemAsset']);
    expect(op(plan, 'replaceItemAsset')!.itemId).toBe('b');
  });
});
