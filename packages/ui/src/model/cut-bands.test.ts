import { describe, expect, it } from 'vitest';
import type { AssetRecord, AudioItem, MediaTime, VideoItem } from '@baocut/protocol';
import { audioItem, captionItem, sequence, track, videoItem } from '../testing/sequence-records.ts';
import { bandRestore, bandWordMarks, cutBands, cutText, dragBandEdge, retimeOperations, type CutBand } from './cut-bands.ts';
import type { SpeechWord } from './speech-cues.ts';

const fps = { num: 30, den: 1 };
const TRACKS = [track('v1', 'visual', 0), track('a1', 'audio', 1), track('s1', 'subtitle', 2), track('v2', 'visual', 3), track('a2', 'audio', 4)];
const src = (seconds: number, timescale = 1000): MediaTime => ({ ticks: String(Math.round(seconds * timescale)), timescale });
const linear = (sourceIn: number, timescale = 1000) => ({ kind: 'linear' as const, sourceIn: src(sourceIn, timescale), rate: { num: 1, den: 1 } });
const ref = (id = 'asset_a') => ({ id, revision: '1' });

const video = (id: string, fromFrame: number, durationFrames: number, sourceIn: number, extra: Partial<VideoItem> = {}) =>
  videoItem(id, 'v1', fromFrame, durationFrames, { assetRef: ref(), timeMap: linear(sourceIn), ...extra });
const audio = (id: string, fromFrame: number, seconds: number, sourceIn: number, extra: Partial<AudioItem> = {}) =>
  audioItem(id, 'a1', fromFrame, seconds, { assetRef: ref(), timeMap: linear(sourceIn, 48000), ...extra });

const ASSETS: Record<string, AssetRecord> = {
  asset_a: {
    id: 'asset_a',
    kind: 'video',
    name: '口播.mp4',
    currentRevision: '1',
    revisions: {
      '1': {
        revision: '1',
        contentHash: 'h',
        byteLength: 1,
        mediaType: 'video/mp4',
        storage: { mode: 'managed' },
        duration: src(12),
        provenance: { origin: 'import' },
      },
    },
  },
};

/** 文稿剪过一刀的样子（S03）：素材 [0, 4) 在 [0, 120)，[6, 12) 在 [120, 300)；视频与链接的音频，加一条作用实例指向它们的字幕。 */
function afterCut(extra: Parameters<typeof sequence>[1] = []) {
  return sequence(TRACKS, [
    video('va', 0, 120, 0, { linkGroupId: 'g1' }),
    video('vb', 120, 180, 6, { linkGroupId: 'g2' }),
    audio('aa', 0, 4, 0, { linkGroupId: 'g1' }),
    audio('ab', 120, 6, 6, { linkGroupId: 'g2' }),
    captionItem('c1', 's1', 'doc_cap', 0, 300, { scopeItemIds: ['va', 'aa', 'vb', 'ab'] }),
    audioItem('bgm', 'a2', 0, 20, { assetRef: ref('asset_music') }),
    ...extra,
  ]);
}

/** 12 秒的素材，每秒一个词：`词i` 在 [i, i + 0.8)。 */
const WORDS: SpeechWord[] = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, start: i, end: i + 0.8, text: `词${i}`, paragraphStart: false }));

const band = (s = afterCut()): CutBand => cutBands(s)[0]!;
const marks = (b: CutBand, words: SpeechWord[] = WORDS) => bandWordMarks(b, words, fps);

describe('cutBands', () => {
  it('视频与链接音频在同一处的剪口并成一条带：代表剪口取视频，长度按恢复的帧数；两缘夹在相邻实例里、各留一帧', () => {
    expect(cutBands(afterCut())).toEqual([
      {
        key: 'asset_a@120',
        assetId: 'asset_a',
        leftId: 'va',
        rightId: 'vb',
        trackIds: ['v1', 'a1'],
        frame: 120,
        from: 4,
        to: 6,
        rate: 1,
        frames: 60,
        lo: -119,
        hi: 239,
      },
    ]);
  });

  it('相邻实例的另一头也是剪口时可以拖到头（两处剪口并成一处）', () => {
    const s = sequence(TRACKS, [video('a', 0, 60, 0), video('b', 60, 60, 4), video('c', 120, 60, 8)]);
    expect(cutBands(s).map((b) => [b.leftId, b.rightId, b.frames, b.lo, b.hi])).toEqual([
      ['a', 'b', 60, -59, 120],
      ['b', 'c', 60, -60, 119],
    ]);
  });

  it('没有剪口就没有带', () => {
    expect(cutBands(sequence(TRACKS, [video('a', 0, 120, 0), video('b', 120, 60, 4)]))).toEqual([]);
  });
});

describe('cutText', () => {
  it('至少一半落在剪掉区间里的词按先后拼起来；中文不空格', () => {
    expect(cutText(WORDS, 4, 6)).toBe('词4词5');
    expect(cutText(WORDS, 4.5, 6)).toBe('词5');
    expect(cutText(WORDS, 4.4, 4.6)).toBe('');
  });

  it('西文词带前导空格时空一格', () => {
    const w = (text: string, start: number, end: number): SpeechWord => ({ id: text, start, end, text, paragraphStart: false });
    const words = [w(' know', 5, 5.4), w(' well', 3, 3.8), w(' um', 3.8, 4.4), w(' you', 4.5, 4.9), w(' right', 6, 6.5)];
    expect(cutText(words, 4, 6)).toBe('um you know');
  });
});

describe('bandWordMarks', () => {
  it('剪口左边按左实例、右边按右实例、剪掉的那段按比例换到拖动坐标（帧，相对剪口）', () => {
    const m = marks(band());
    const at = (id: string) => m.find((x) => x.word.id === id);
    const round = (id: string) => [at(id)?.t0, at(id)?.t1].map((t) => Math.round((t ?? NaN) * 1e6) / 1e6);
    expect(round('w3')).toEqual([-30, -6]);
    expect(round('w4')).toEqual([0, 24]);
    expect(round('w6')).toEqual([60, 84]);
    expect(m[0]?.word.id).toBe('w0');
    expect(bandWordMarks({ ...band(), lo: -40, hi: 100 }, WORDS, fps).map((x) => x.word.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8']);
  });
});

describe('dragBandEdge', () => {
  it('缺省吸词边界：左缘吸到最近的词头（留余量、向前取整到帧），右缘吸到最近的词尾', () => {
    const b = band();
    const left = dragBandEdge(b, marks(b), 'start', -25, false, fps);
    expect([left.start, left.end, left.word?.id, left.changed]).toEqual([-32, 60, 'w3', true]);
    const near = dragBandEdge(b, marks(b), 'start', -10, false, fps);
    expect([near.start, near.word?.id]).toEqual([-2, 'w4']);
    const right = dragBandEdge(b, marks(b), 'end', 20, false, fps);
    expect([right.start, right.end, right.word?.id]).toEqual([0, 86, 'w6']);
  });

  it('按住 Alt 自由落点，对齐到帧；没有词时也退回自由', () => {
    const b = band();
    const free = dragBandEdge(b, marks(b), 'start', -25.4, true, fps);
    expect([free.start, free.word]).toEqual([-25, null]);
    expect(dragBandEdge(b, [], 'start', -25.4, false, fps).start).toBe(-25);
  });

  it('夹取：越界贴住极限；拖过另一条边就是零宽', () => {
    const b = band();
    expect(dragBandEdge(b, marks(b), 'start', -500, false, fps).start).toBe(-119);
    expect(dragBandEdge(b, marks(b), 'end', 1000, false, fps).end).toBe(239);
    const shut = dragBandEdge(b, marks(b), 'start', 100, false, fps);
    expect([shut.start, shut.end, shut.changed]).toEqual([60, 60, true]);
    const shutRight = dragBandEdge(b, marks(b), 'end', -100, false, fps);
    expect([shutRight.start, shutRight.end]).toEqual([0, 0]);
  });

  it('按下没挪动原样返回', () => {
    const b = band();
    expect(dragBandEdge(b, marks(b), 'end', 0, false, fps)).toEqual({ edge: 'end', start: 0, end: 60, word: null, changed: false });
  });
});

describe('retimeOperations', () => {
  /** `afterCut()` 的剪口：素材 [4, 6)。 */
  const CUTS = [{ id: 'cut-1', from: 4, to: 6 }];
  const restoreCut = { type: 'restoreCut', sequenceId: 'seq', assetId: 'asset_a', cutId: 'cut-1' };

  it('一笔事务：先 restoreCut 放回这一处，再 addCuts 剪新的素材区间', () => {
    const s = afterCut();
    const plan = retimeOperations(s, ASSETS, band(s), CUTS, { start: -32, end: 60 });
    expect(plan?.ok).toBe(true);
    if (!plan?.ok) return;
    expect(plan.frames).toBe(92);
    // 左缘往前拖 32 帧：素材 4 - 32/30 秒。
    expect(plan.operations).toEqual([
      restoreCut,
      { type: 'addCuts', sequenceId: 'seq', assetId: 'asset_a', cuts: [{ from: '2.933333', to: '6' }] },
    ]);
  });

  it('右缘往后拖：剪口之后多剪一截', () => {
    const s = afterCut();
    const plan = retimeOperations(s, ASSETS, band(s), CUTS, { start: 0, end: 86 });
    const add = plan?.ok ? plan.operations.at(-1) : null;
    expect(add?.type === 'addCuts' && add.cuts).toEqual([{ from: '4', to: '6.866667' }]);
  });

  it('拖到零宽只恢复；范围没变不写', () => {
    const s = afterCut();
    const plan = retimeOperations(s, ASSETS, band(s), CUTS, { start: 60, end: 60 });
    expect(plan?.ok && [plan.frames, plan.operations]).toEqual([0, [restoreCut]]);
    expect(retimeOperations(s, ASSETS, band(s), CUTS, { start: 0, end: 60 })).toBeNull();
  });

  it('剪口差半帧以内也算对上接缝；没有剪口是 untracked，只盖住一部分是 partial', () => {
    const s = afterCut();
    const near = [{ id: 'cut-1', from: 4.01, to: 6 }];
    expect(retimeOperations(s, ASSETS, band(s), near, { start: 0, end: 30 })?.ok).toBe(true);
    expect(retimeOperations(s, ASSETS, band(s), [], { start: -10, end: 60 })).toEqual({ ok: false, reason: 'untracked' });
    const part = [{ id: 'cut-1', from: 5, to: 6 }];
    expect(retimeOperations(s, ASSETS, band(s), part, { start: -10, end: 60 })).toEqual({ ok: false, reason: 'partial' });
    // 只恢复不要求整个盖住：点一下带放回盖住的那部分。
    expect(bandRestore(s, band(s), part)).toMatchObject({ ok: true, cutIds: ['cut-1'], seconds: 1 });
  });
});
