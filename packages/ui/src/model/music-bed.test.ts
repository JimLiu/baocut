import { describe, expect, it } from 'vitest';
import type { AssetRecord } from '@baocut/protocol';
import { audioItem, sequence, track, videoItem } from '../testing/sequence-records.ts';
import { assetOnTimeline, importedMusicBedOperations, jobOnTimeline, LOOP, loopLayout, loopSummary, MUSIC_ROLE, musicBedOperations, placedSoundtrackJobs, SOUNDTRACK_EXTENSION, type LoopPiece } from './music-bed.ts';

const music = (seconds: number, extra: Partial<AssetRecord> = {}): AssetRecord =>
  ({
    id: 'asset_m',
    kind: 'audio',
    name: 'calm piano.wav',
    currentRevision: '2',
    revisions: { '2': { revision: '2', duration: { ticks: String(seconds * 44100), timescale: 44100 } } },
    ...extra,
  }) as unknown as AssetRecord;

/** 每一刻都有声音：相邻两段重叠正好一个交叉淡化，交替两条轨，最后一段收在视频结尾（设计稿 model-music.test.js `assertCovers`）。 */
function expectCovers(layout: LoopPiece[], total: number) {
  expect(layout[0]!.start).toBe(0);
  layout.forEach((s, i) => {
    expect(s.lane).toBe(i % 2);
    expect(s.fadeIn + s.fadeOut).toBeLessThanOrEqual(s.dur + 1e-9);
    if (i > 0) {
      const prev = layout[i - 1]!;
      expect(prev.start + prev.dur - s.start).toBeCloseTo(s.fadeIn, 3);
      expect(s.fadeIn).toBe(prev.fadeOut);
    }
  });
  const last = layout[layout.length - 1]!;
  expect(last.start + last.dur).toBeCloseTo(total, 3);
}

describe('配乐铺满（设计稿 model-music.js loopLayout）', () => {
  it('音乐比视频长只有一段，截到结尾、片尾淡出', () => {
    const l = loopLayout(300, 206);
    expect(l).toEqual([{ start: 0, dur: 206, lane: 0, fadeIn: 0, fadeOut: 3 }]);
    expect(loopSummary(l, 206)).toBe('片尾淡出 3 秒');
  });

  it('首尾相接、接缝交叉淡化 2 秒、交替两条轨，最后一段片尾淡出', () => {
    const l = loopLayout(300, 742);
    expectCovers(l, 742);
    expect(l.map((s) => s.start)).toEqual([0, 298, 596]);
    expect(l.map((s) => s.dur)).toEqual([300, 300, 146]);
    expect(l.map((s) => [s.fadeIn, s.fadeOut])).toEqual([
      [0, 2],
      [2, 2],
      [2, 3],
    ]);
    expect(loopSummary(l, 742)).toBe('循环 3 段铺满 742 秒 · 接缝交叉淡化 2 秒 · 片尾淡出 3 秒');
  });

  it('正好整段数、剩一小截时最后一段仍长过交叉淡化；音乐写长了按实际时长铺；超长视频', () => {
    const exact = loopLayout(300, 598); // 300 + 298：第二段正好放完
    expectCovers(exact, 598);
    expect(exact).toHaveLength(2);
    expect(exact[1]!.dur).toBe(300);
    const sliver = loopLayout(300, 299); // 只多出 1 秒：前一段收尾时第二段进来
    expectCovers(sliver, 299);
    expect(sliver).toHaveLength(1);
    const tiny = loopLayout(300, 301);
    expectCovers(tiny, 301);
    expect(tiny).toHaveLength(2);
    expect(tiny[1]!.dur).toBeGreaterThan(tiny[1]!.fadeIn);
    expect(tiny[1]!.fadeOut).toBeLessThanOrEqual(tiny[1]!.dur - tiny[1]!.fadeIn);
    expectCovers(loopLayout(360, 3120), 3120);
    expect(loopLayout(0, 100)).toEqual([]);
    expect(loopLayout(30, 0)).toEqual([]);
  });

  it('很短的音乐：交叉淡化不超过一段的四分之一，淡入淡出之和不超过片段长度', () => {
    const l = loopLayout(4, 10);
    expectCovers(l, 10);
    expect(l[1]!.fadeIn).toBe(1);
    expect(l.every((s) => s.fadeIn <= 5 && s.fadeOut <= 5)).toBe(true);
    expect(LOOP).toEqual({ crossfade: 2, tailFade: 3 });
  });
});

describe('musicBedOperations：一笔事务里新建音乐轨、每段一个音频实例', () => {
  // 742 秒 = 22260 帧 @30fps
  const long = sequence([track('t1', 'visual', 0)], [videoItem('v1', 't1', 0, 742 * 30)]);

  it('视频比音乐长：两条音乐轨交替，起点拆成帧与帧内偏移，长度与淡化按铺法', () => {
    const r = musicBedOperations(long, music(300), 'job_1');
    expect(r).not.toBeNull();
    const { operations, layout, totalSec } = r!;
    expect(totalSec).toBe(742);
    expect(layout).toHaveLength(3);
    expect(operations[0]).toEqual({ type: 'addTrack', sequenceId: 'seq', kind: 'audio', ref: 'music-bed-0', name: '音乐' });
    expect(operations[1]).toEqual({ type: 'addTrack', sequenceId: 'seq', kind: 'audio', ref: 'music-bed-1', name: '音乐 2' });
    const insert = operations[2]!;
    if (insert.type !== 'insertItems') throw new Error(insert.type);
    expect(insert.items.map((i) => (i as { trackRef: string }).trackRef)).toEqual(['music-bed-0', 'music-bed-1', 'music-bed-0']);
    const second = insert.items[1] as Extract<(typeof insert.items)[number], { type: 'audio' }>;
    expect(second).toMatchObject({
      type: 'audio',
      assetRef: { id: 'asset_m', revision: '2' },
      fromFrame: 298 * 30,
      subframeOffset: { ticks: '0', timescale: 30000 },
      playDuration: { ticks: '300000', timescale: 1000 },
      timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
      mix: { volume: 1, fadeIn: { ticks: '2000', timescale: 1000 }, fadeOut: { ticks: '2000', timescale: 1000 } },
      name: 'calm piano.wav',
      role: MUSIC_ROLE,
      extensions: { [SOUNDTRACK_EXTENSION]: { jobId: 'job_1' } },
    });
    const first = insert.items[0] as typeof second;
    expect(first.mix).toEqual({ volume: 1, fadeOut: { ticks: '2000', timescale: 1000 } });
    const last = insert.items[2] as typeof second;
    expect(last.playDuration).toEqual({ ticks: '146000', timescale: 1000 });
    expect(last.mix.fadeOut).toEqual({ ticks: '3000', timescale: 1000 });
  });

  it('非整数帧率：帧内偏移在一帧之内、以毫秒为整数算', () => {
    const ntsc = sequence([track('t1', 'visual', 0)], [videoItem('v1', 't1', 0, 20000)], { fps: { num: 30000, den: 1001 } });
    const r = musicBedOperations(ntsc, music(300), 'job_1')!;
    const insert = r.operations.find((op) => op.type === 'insertItems')!;
    if (insert.type !== 'insertItems') throw new Error(insert.type);
    const second = insert.items[1] as Extract<(typeof insert.items)[number], { type: 'audio' }>;
    // 298 秒 = 298000 ms；帧 = floor(298000 × 30000 / (1000 × 1001)) = 8931；余下的刻度小于一帧（1001 × 1000）
    expect(second.fromFrame).toBe(8931);
    expect(second.subframeOffset.timescale).toBe(30_000_000);
    const ticks = Number(second.subframeOffset.ticks);
    expect(ticks).toBeGreaterThanOrEqual(0);
    expect(ticks).toBeLessThan(1001 * 1000);
    expect(ticks).toBe(298000 * 30000 - 8931 * 1001 * 1000);
  });

  it('视频不比音乐长：一条音乐轨、一段截到结尾', () => {
    const short = sequence([track('t1', 'visual', 0)], [videoItem('v1', 't1', 0, 206 * 30)]);
    const r = musicBedOperations(short, music(300), 'job_1')!;
    expect(r.operations.filter((op) => op.type === 'addTrack')).toHaveLength(1);
    const insert = r.operations[1]!;
    if (insert.type !== 'insertItems') throw new Error(insert.type);
    expect(insert.items).toHaveLength(1);
    expect(insert.items[0]).toMatchObject({ fromFrame: 0, playDuration: { ticks: '206000', timescale: 1000 }, mix: { volume: 1, fadeOut: { ticks: '3000', timescale: 1000 } } });
  });

  it('空时间线、没时长的素材、不是音频的素材都不铺', () => {
    expect(musicBedOperations(sequence([track('t1', 'visual', 0)], []), music(300), 'job_1')).toBeNull();
    expect(musicBedOperations(long, music(300, { revisions: { '2': { revision: '2' } } } as unknown as Partial<AssetRecord>), 'job_1')).toBeNull();
    expect(musicBedOperations(long, music(300, { kind: 'video' } as Partial<AssetRecord>), 'job_1')).toBeNull();
  });

  it('素材时长不是整毫秒：铺的长度向下取整，不比素材长；最后一段不越过序列末尾', () => {
    // 299.99977… 秒 @44.1 kHz
    const odd = music(300, { revisions: { '2': { revision: '2', duration: { ticks: '13229990', timescale: 44100 } } } } as unknown as Partial<AssetRecord>);
    const r = musicBedOperations(long, odd, 'job_1')!;
    const insert = r.operations.find((op) => op.type === 'insertItems')!;
    if (insert.type !== 'insertItems') throw new Error(insert.type);
    for (const item of insert.items as Extract<(typeof insert.items)[number], { type: 'audio' }>[]) {
      // playDuration ≤ 素材时长，按有理数比：ticks/1000 ≤ 13229990/44100
      expect(Number(item.playDuration.ticks) * 44100).toBeLessThanOrEqual(13229990 * 1000);
    }
    expect(insert.items[0]).toMatchObject({ playDuration: { ticks: '299999', timescale: 1000 } });
    const last = r.layout[r.layout.length - 1]!;
    expect(last.start + last.dur).toBeLessThanOrEqual(742 + 1e-9);
    // 序列时长不是整毫秒（NTSC 20000 帧 = 667.333… 秒）：总长向下取整，最后一段的终点不越过序列末尾
    const ntsc = sequence([track('t1', 'visual', 0)], [videoItem('v1', 't1', 0, 20000)], { fps: { num: 30000, den: 1001 } });
    const n = musicBedOperations(ntsc, music(300), 'job_1')!;
    expect(n.totalSec).toBe(667.333);
    const tail = n.layout[n.layout.length - 1]!;
    expect(tail.start + tail.dur).toBeLessThanOrEqual((20000 * 1001) / 30000 + 1e-9);
  });

  it('再铺一床就换掉上一床：同一笔里先删上一床的实例与只放着它们的音乐轨', () => {
    const mark = { [SOUNDTRACK_EXTENSION]: { jobId: 'job_0' } };
    const withBed = sequence(
      [track('t1', 'visual', 0), track('m1', 'audio', 1), track('m2', 'audio', 2), track('a3', 'audio', 3)],
      [
        videoItem('v1', 't1', 0, 742 * 30),
        audioItem('b1', 'm1', 0, 300, { extensions: mark }),
        audioItem('b2', 'm2', 298 * 30, 300, { extensions: mark }),
        audioItem('b3', 'm1', 596 * 30, 146, { extensions: mark }),
        // 第三条音乐轨上用户自己放了别的声音：轨留着
        audioItem('b4', 'a3', 0, 10, { extensions: mark }),
        audioItem('x1', 'a3', 400 * 30, 5, { assetRef: { id: 'asset_x', revision: '1' } }),
      ],
    );
    expect(placedSoundtrackJobs(withBed)).toEqual(new Set(['job_0']));
    const r = musicBedOperations(withBed, music(300), 'job_1')!;
    expect(r.operations.slice(0, 3)).toEqual([
      { type: 'deleteItems', sequenceId: 'seq', itemIds: ['b1', 'b2', 'b3', 'b4'] },
      { type: 'deleteTrack', sequenceId: 'seq', trackId: 'm1' },
      { type: 'deleteTrack', sequenceId: 'seq', trackId: 'm2' },
    ]);
    expect(r.operations.filter((op) => op.type === 'addTrack')).toHaveLength(2);
  });

  it('引用同一笔里刚导入的素材时铺法相同，上一床照样换掉；空时间线放完整的一段；时长不成立时不铺', () => {
    const video = sequence([track('t1', 'visual', 0)], [videoItem('v1', 't1', 0, 300)]);
    const source = { ref: 'drop0', name: 'calm.wav', pieceSec: 4 };
    const fromAsset = musicBedOperations(video, music(4, { name: 'calm.wav' }), 'job_1')!;
    const fromImport = importedMusicBedOperations(video, source, 'job_1')!;
    expect(fromImport.layout).toEqual(fromAsset.layout);
    const items = (ops: typeof fromImport.operations) => (ops.at(-1) as { items: Record<string, unknown>[] }).items;
    expect(items(fromImport.operations).map(({ assetImportRef: _ref, ...rest }) => rest)).toEqual(items(fromAsset.operations).map(({ assetRef: _ref, ...rest }) => rest));
    expect(items(fromImport.operations).every((i) => i.assetImportRef === 'drop0' && !('assetRef' in i))).toBe(true);

    const empty = importedMusicBedOperations(sequence([track('t1', 'visual', 0)], []), source, 'job_1')!;
    expect(empty.totalSec).toBe(4);
    expect(empty.layout).toHaveLength(1);
    expect(importedMusicBedOperations(video, { ...source, pieceSec: 0 }, 'job_1')).toBeNull();
  });

  it('任务的音乐在时间线上：铺过的看实例，用户放过的看素材的来源', () => {
    const base = [track('t1', 'visual', 0), track('a1', 'audio', 1)];
    const assetOf = (jobId: string) => ({
      asset_m: music(10, { revisions: { '2': { revision: '2', provenance: { origin: 'generated', source: { jobId } } } } } as unknown as Partial<AssetRecord>),
    });
    const laid = sequence(base, [audioItem('b1', 'a1', 0, 10, { extensions: { [SOUNDTRACK_EXTENSION]: { jobId: 'job_1' } } })]);
    expect(jobOnTimeline(laid, {}, 'job_1')).toBe(true);
    const manual = sequence(base, [audioItem('m1', 'a1', 0, 10, { assetRef: { id: 'asset_m', revision: '2' } })]);
    expect(jobOnTimeline(manual, assetOf('job_1'), 'job_1')).toBe(true);
    expect(jobOnTimeline(manual, assetOf('job_2'), 'job_1')).toBe(false);
    expect(jobOnTimeline(sequence(base, []), assetOf('job_1'), 'job_1')).toBe(false);
  });

  it('素材已经在时间线上就不再铺', () => {
    const placed = sequence([track('t1', 'visual', 0), track('a1', 'audio', 1)], [videoItem('v1', 't1', 0, 300), audioItem('m1', 'a1', 0, 10, { assetRef: { id: 'asset_m', revision: '2' } })]);
    expect(assetOnTimeline(placed, 'asset_m')).toBe(true);
    expect(assetOnTimeline(placed, 'asset_x')).toBe(false);
  });
});
