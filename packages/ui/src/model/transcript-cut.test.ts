import { describe, expect, it } from 'vitest';
import type {
  AssetRecord,
  AudioItem,
  CaptionItem,
  CutSetBody,
  DocumentRecord,
  EditOperation,
  Sequence,
  Track,
  VideoItem,
} from '@baocut/protocol';
import { readSpeechWords, type SpeechWord } from './speech-cues.ts';
import {
  centerScrollTop,
  cutOperations,
  cutSeams,
  cutTrackIds,
  editWordText,
  hideWords,
  paragraphPlayed,
  paragraphPlayedSpan,
  placementIndex,
  playedIndex,
  playedUntil,
  rawWordId,
  readCutSet,
  restoreOperations,
  restoreRanges,
  staleCaptions,
  transcriptParagraphs,
  transcriptWords,
  wordAt,
} from './transcript-cut.ts';

const fps = { num: 30, den: 1 };
const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };

function video(id: string, fromFrame: number, durationFrames: number, sourceIn: number, extra: Partial<VideoItem> = {}): VideoItem {
  return {
    ...base,
    id,
    trackId: 'v1',
    type: 'video',
    span: { fromFrame, durationFrames },
    place: {},
    mode: 'fullscreen',
    assetRef: { id: 'asset_a', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: String(Math.round(sourceIn * 1000)), timescale: 1000 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
    ...extra,
  };
}

/** 帧网格上的音频（`fromFrame` 帧起，`seconds` 秒长），可以给子帧偏移（48 kHz 采样数）。 */
function audio(
  id: string,
  fromFrame: number,
  seconds: number,
  sourceIn: number,
  extra: Partial<AudioItem> & { subSamples?: number } = {},
): AudioItem {
  const { subSamples = 0, ...rest } = extra;
  return {
    ...base,
    id,
    trackId: 'a1',
    type: 'audio',
    assetRef: { id: 'asset_a', revision: '1' },
    fromFrame,
    subframeOffset: { ticks: String(subSamples), timescale: 48000 },
    playDuration: { ticks: String(Math.round(seconds * 48000)), timescale: 48000 },
    timeMap: { kind: 'linear', sourceIn: { ticks: String(Math.round(sourceIn * 48000)), timescale: 48000 }, rate: { num: 1, den: 1 } },
    mix: { volume: 1 },
    ...rest,
  };
}

function caption(
  id: string,
  fromFrame: number,
  durationFrames: number,
  scopeItemIds?: string[],
  extra: Partial<CaptionItem> = {},
): CaptionItem {
  return {
    ...base,
    id,
    trackId: 's1',
    type: 'caption',
    span: { fromFrame, durationFrames },
    documentId: 'doc_cap',
    ...(scopeItemIds ? { scopeItemIds } : {}),
    ...extra,
  };
}

const track = (id: string, order: number, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({
  id,
  order,
  kind,
  locked: false,
  visible: true,
  muted: false,
  solo: { enabled: false, group: kind === 'audio' ? 'audio' : 'visual' },
  ...extra,
});

const TRACKS = [
  track('v1', 0, 'visual'),
  track('a1', 1, 'audio'),
  track('s1', 2, 'subtitle'),
  track('v2', 3, 'visual'),
  track('a2', 4, 'audio'),
];

function seq(items: Sequence['items'], tracks: Track[] = TRACKS): Sequence {
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
  } as Sequence;
}

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
        duration: { ticks: '12000', timescale: 1000 },
        provenance: { origin: 'import' },
      },
    },
  },
};

/** 12 秒的素材，每秒一个词：`词0` 在 [0, len)、`词1` 在 [1, 1 + len)……（产品设计 S03 的例子）。 */
function words(len = 1, count = 12): SpeechWord[] {
  return Array.from({ length: count }, (_, i) => ({ id: `w${i}`, start: i, end: i + len, text: `词${i}`, paragraphStart: false }));
}

/** S03：整段放上时间线，视频与链接的音频，加一条作用实例指向它们的字幕。 */
function whole(): Sequence {
  return seq([
    video('va', 0, 360, 0, { linkGroupId: 'g1' }),
    audio('aa', 0, 12, 0, { linkGroupId: 'g1' }),
    caption('c1', 0, 360, ['va', 'aa']),
    audio('bgm', 0, 20, 0, { trackId: 'a2', assetRef: { id: 'asset_music', revision: '1' } }),
  ]);
}

/** S03 剪完的样子：源 [0, 4) 在 [0, 120)，源 [6, 12) 在 [120, 300)。 */
function afterCut(extra: Sequence['items'] = []): Sequence {
  return seq([
    video('va', 0, 120, 0, { linkGroupId: 'g1' }),
    video('vb', 120, 180, 6, { linkGroupId: 'g2' }),
    audio('aa', 0, 4, 0, { linkGroupId: 'g1' }),
    audio('ab', 120, 6, 6, { linkGroupId: 'g2' }),
    caption('c1', 0, 300, ['va', 'aa', 'vb', 'ab']),
    audio('bgm', 0, 20, 0, { trackId: 'a2', assetRef: { id: 'asset_music', revision: '1' } }),
    ...extra,
  ]);
}

/** `afterCut()` 对应的剪口集合：素材 [4, 6) 一个剪口，刻度 1000。 */
const CUT_SET: CutSetBody = {
  schema: 'baocut.cut-set/1',
  timescale: 1000,
  clock: 'source-asset',
  scopeItemIds: [],
  cuts: [{ id: 'cut-1', t0: '4000', t1: '6000', ref: 'sug-1' }],
};

const cutsOf = (ops: EditOperation[]) => ops.map((op) => (op.type === 'addCuts' ? [op.sequenceId, op.assetId, op.cuts] : op.type));

describe('transcriptWords', () => {
  it('从时间线推导剪没剪：投不到的词是剪掉，剪口落在词中间的只剩一部分', () => {
    const list = words(0.8);
    list[3] = { ...list[3]!, start: 3.5, end: 4.5 };
    const result = transcriptWords(afterCut(), 'asset_a', list);
    expect(result.map((w) => w.state)).toEqual([
      'kept',
      'kept',
      'kept',
      'partial',
      'cut',
      'cut',
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
    ]);
    // 链接的视频与音频取用同一素材：按起点、再按 ID 排，先占窗口的是音频（与 text_plan.rs 相同）。
    expect(result[6]!.placements.map((p) => [p.scopeItemId, p.start])).toEqual([['ab', 4]]);
    expect(result.map((w) => w.index)).toEqual([...Array(12).keys()]);
  });

  it('剪口取整后只剩一丝（不到一成）的词算整个剪掉，那一丝不当落点', () => {
    const list = words(0.8);
    list[3] = { ...list[3]!, start: 3.98, end: 4.9 };
    const result = transcriptWords(afterCut(), 'asset_a', list);
    expect(result[3]!.state).toBe('cut');
    expect(result[3]!.placements).toEqual([]);
  });

  it('词按开始时刻排，西文词之间空一格、中文不空', () => {
    const list: SpeechWord[] = [
      { id: 'b', start: 1, end: 1.5, text: 'world', paragraphStart: false },
      { id: 'a', start: 0, end: 0.5, text: 'hello', paragraphStart: false },
      { id: 'c', start: 2, end: 2.5, text: '你好', paragraphStart: false },
      { id: 'd', start: 3, end: 3.5, text: '，', paragraphStart: false },
    ];
    const result = transcriptWords(whole(), 'asset_a', list);
    expect(result.map((w) => [w.id, w.spaced])).toEqual([
      ['a', false],
      ['b', true],
      ['c', false],
      ['d', false],
    ]);
  });

  it('播放头找词：落在词里给下标，落在停顿里没有', () => {
    const result = transcriptWords(afterCut(), 'asset_a', words(0.8));
    const index = placementIndex(result);
    expect(wordAt(index, 0.5)).toBe(0);
    expect(wordAt(index, 0.9)).toBeNull();
    // 序列 4.2 秒是素材 6.2 秒：词6。
    expect(wordAt(index, 4.2)).toBe(6);
  });
});

describe('已读的词（播放跟随）', () => {
  it('游标只在播放头跨过词尾时变；剪掉的词不算', () => {
    // afterCut：词0–3 在序列 [i, i + 0.8)，词4、5 剪掉，词6–11 在 [i - 2, i - 1.2)。
    const result = transcriptWords(afterCut(), 'asset_a', words(0.8));
    const ends = playedIndex(result);
    expect(ends).toHaveLength(10);
    expect(playedUntil(ends, 0.5)).toBe(-Infinity);
    expect(playedUntil(ends, 0.8)).toBeCloseTo(0.8);
    // 停顿里、下一个词里都不变。
    expect(playedUntil(ends, 0.95)).toBeCloseTo(0.8);
    expect(playedUntil(ends, 1.5)).toBeCloseTo(0.8);
    expect(playedUntil(ends, 1.8)).toBeCloseTo(1.8);
    // 序列 4.9 秒：词6 在 [4, 4.8) 读完了。
    expect(playedUntil(ends, 4.9)).toBeCloseTo(4.8);
    expect(playedUntil(ends, 100)).toBeCloseTo(9.8);
  });

  it('同一段素材用了两次：播完第一处就算读过', () => {
    const twice = seq([video('va', 0, 120, 0), video('vb', 120, 120, 0)]);
    const result = transcriptWords(twice, 'asset_a', words(0.8, 4));
    expect(result[0]!.placements).toHaveLength(2);
    const ends = playedIndex(result);
    expect(ends).toHaveLength(4);
    expect(playedUntil(ends, 0.9)).toBeCloseTo(0.8);
    // 序列 4.5 秒在词0 的第二处落点里：它早已读过（游标停在词3 的第一处）。
    expect(playedUntil(ends, 4.5)).toBeCloseTo(3.8);
  });

  it('段的阈值：没读到是 -Infinity，读完是 Infinity，读到一半给游标；整段剪掉永远没读', () => {
    const result = transcriptWords(afterCut(), 'asset_a', words(0.8));
    const head = paragraphPlayedSpan(result.slice(0, 4));
    expect(head?.[0]).toBeCloseTo(0.8);
    expect(head?.[1]).toBeCloseTo(3.8);
    expect(paragraphPlayed(head, -Infinity)).toBe(-Infinity);
    expect(paragraphPlayed(head, 1.8)).toBe(1.8);
    expect(paragraphPlayed(head, 3.8)).toBe(Infinity);
    const gone = paragraphPlayedSpan(result.slice(4, 6));
    expect(gone).toBeNull();
    expect(paragraphPlayed(gone, 100)).toBe(-Infinity);
  });

  it('居中位置夹在可滚范围里', () => {
    // 视口 400、内容 2000：第 1000 像素处 20 高的词 → 810。
    expect(centerScrollTop(2000, 400, 1000, 20)).toBe(810);
    expect(centerScrollTop(2000, 400, 50, 20)).toBe(0);
    expect(centerScrollTop(2000, 400, 1990, 20)).toBe(1600);
    expect(centerScrollTop(300, 400, 200, 20)).toBe(0);
  });
});

describe('transcriptParagraphs', () => {
  it('换说话人、标了段首、停顿两秒以上时分段', () => {
    const list: SpeechWord[] = [
      { id: 'a', start: 0, end: 0.5, text: '一', speaker: 's1', paragraphStart: false },
      { id: 'b', start: 0.6, end: 1, text: '二', speaker: 's1', paragraphStart: false },
      { id: 'c', start: 1.1, end: 1.5, text: '三', speaker: 's2', paragraphStart: false },
      { id: 'd', start: 4, end: 4.5, text: '四', speaker: 's2', paragraphStart: false },
      { id: 'e', start: 4.6, end: 5, text: '五', speaker: 's2', paragraphStart: true },
    ];
    const paragraphs = transcriptParagraphs(transcriptWords(whole(), 'asset_a', list));
    expect(paragraphs.map((p) => [p.key, p.speaker, p.words.map((w) => w.id).join('')])).toEqual([
      ['a', 's1', 'ab'],
      ['c', 's2', 'c'],
      ['d', 's2', 'd'],
      ['e', 's2', 'e'],
    ]);
  });
});

describe('cutTrackIds', () => {
  it('取用素材的轨道、链接实例的轨道、作用实例指向它们的字幕轨；背景音乐与没写作用实例的字幕不算', () => {
    const sequence = seq(
      [
        video('va', 0, 360, 0, { linkGroupId: 'g1' }),
        audio('linked', 0, 12, 0, { linkGroupId: 'g1', trackId: 'a2', assetRef: { id: 'asset_other', revision: '1' } }),
        caption('c1', 0, 360, ['va']),
        caption('c2', 0, 360, undefined, { trackId: 's2' }),
        audio('bgm', 0, 20, 0, { trackId: 'a1', assetRef: { id: 'asset_music', revision: '1' } }),
      ],
      [...TRACKS, track('s2', 5, 'subtitle')],
    );
    expect(cutTrackIds(sequence, 'asset_a')).toEqual(['v1', 's1', 'a2']);
  });
});

describe('cutOperations', () => {
  it('S03：删素材 [4, 6) 编成一笔 addCuts，区间是素材秒；序列上删 60 帧', () => {
    const sequence = whole();
    const list = transcriptWords(sequence, 'asset_a', words());
    const plan = cutOperations(sequence, ASSETS, 'asset_a', list, new Set([4, 5]));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(cutsOf(plan.operations)).toEqual([['seq', 'asset_a', [{ from: '4', to: '6' }]]]);
    expect(plan.frames).toBe(60);
    expect(plan.words).toBe(2);
  });

  it('一串选中的词连同词间的停顿一起剪；多段按先后编进同一个 addCuts', () => {
    const sequence = whole();
    const list = transcriptWords(sequence, 'asset_a', words(0.8));
    const plan = cutOperations(sequence, ASSETS, 'asset_a', list, new Set([2, 3, 8]));
    expect(plan.ok && cutsOf(plan.operations)).toEqual([
      [
        'seq',
        'asset_a',
        [
          { from: '2', to: '3.8' },
          { from: '8', to: '8.8' },
        ],
      ],
    ]);
    expect(plan.ok && plan.frames).toBe(78);
  });

  it('没选中的已剪词不打断一串；跨剪口的两段合成一段', () => {
    const sequence = afterCut();
    const list = transcriptWords(sequence, 'asset_a', words());
    // 词3（va 的最后一个词）、词4/5 已剪、词6（vb 的第一个词）：一段素材 [3, 7)，引擎与已有的剪口合并。
    const plan = cutOperations(sequence, ASSETS, 'asset_a', list, new Set([3, 6]));
    expect(plan.ok && [plan.ranges, plan.frames]).toEqual([[{ from: 3, to: 7 }], 60]);
    // 选中的都已经剪掉了。
    expect(cutOperations(sequence, ASSETS, 'asset_a', list, new Set([4, 5]))).toEqual({ ok: false, reason: 'nothing' });
  });

  it('没选中的留着的词把一串断开', () => {
    const sequence = whole();
    const list = transcriptWords(sequence, 'asset_a', words());
    const plan = cutOperations(sequence, ASSETS, 'asset_a', list, new Set([2, 4]));
    expect(plan.ok && plan.ranges).toEqual([
      { from: 2, to: 3 },
      { from: 4, to: 5 },
    ]);
  });

  it('同一段素材用了两次：只编一个素材区间，引擎在两处都剪', () => {
    const sequence = seq([video('va', 0, 120, 0), video('vb', 150, 120, 0)]);
    const list = transcriptWords(sequence, 'asset_a', words());
    const plan = cutOperations(sequence, ASSETS, 'asset_a', list, new Set([1]));
    expect(plan.ok && [plan.ranges, plan.frames]).toEqual([[{ from: 1, to: 2 }], 60]);
  });

  it('剪口不超出素材时长；不足一帧的不编，全都不足一帧时照实拒绝', () => {
    const sequence = whole();
    const long = transcriptWords(sequence, 'asset_a', [{ id: 'x', start: 11.5, end: 12.4, text: '尾', paragraphStart: false }]);
    const plan = cutOperations(sequence, ASSETS, 'asset_a', long, new Set([0]));
    expect(plan.ok && cutsOf(plan.operations)).toEqual([['seq', 'asset_a', [{ from: '11.5', to: '12' }]]]);
    const list = transcriptWords(sequence, 'asset_a', [{ id: 'x', start: 1, end: 1.01, text: '嗯', paragraphStart: false }]);
    expect(cutOperations(sequence, ASSETS, 'asset_a', list, new Set([0]))).toEqual({ ok: false, reason: 'too-short' });
  });
});

describe('restoreOperations', () => {
  const cuts = readCutSet(CUT_SET)!;

  it('读剪口集合：刻度换成素材秒，保留出处；不是剪口集合时返回 null', () => {
    expect(cuts).toEqual([{ id: 'cut-1', from: 4, to: 6, ref: 'sug-1' }]);
    expect(readCutSet({ schema: 'baocut.speech/1' })).toBeNull();
  });

  it('选中的已剪词 → 盖住它们的剪口整个放回，一笔 restoreCut', () => {
    const sequence = afterCut();
    const list = transcriptWords(sequence, 'asset_a', words());
    const ranges = restoreRanges(list, new Set([3, 5, 6]));
    expect(ranges).toEqual([{ from: 5, to: 6 }]);
    const plan = restoreOperations(sequence, 'asset_a', cuts, ranges);
    expect(plan).toEqual({
      ok: true,
      operations: [{ type: 'restoreCut', sequenceId: 'seq', assetId: 'asset_a', cutId: 'cut-1' }],
      cutIds: ['cut-1'],
      seconds: 2,
    });
  });

  it('只碰到剪口边上的不算；没有剪口盖住时照实拒绝（untracked）', () => {
    const sequence = afterCut();
    expect(restoreOperations(sequence, 'asset_a', cuts, [{ from: 6, to: 7 }])).toEqual({ ok: false, reason: 'untracked' });
    expect(restoreOperations(sequence, 'asset_a', [], [{ from: 4, to: 5 }])).toEqual({ ok: false, reason: 'untracked' });
  });
});

describe('cutSeams', () => {
  it('同一轨道上首尾相接、同一素材、素材空了一段的两个实例之间是剪口', () => {
    const seams = cutSeams(afterCut());
    expect(seams.map((s) => [s.trackId, s.leftId, s.rightId, s.frame, s.gap, s.to])).toEqual([
      ['v1', 'va', 'vb', 120, 2, 6],
      ['a1', 'aa', 'ab', 120, 2, 6],
    ]);
  });

  it('时间线上空着、不同素材、素材连续（只是拆开）的都不是剪口', () => {
    const sequence = seq([
      video('a', 0, 120, 0),
      video('b', 150, 60, 6),
      video('c', 210, 30, 8, { assetRef: { id: 'asset_x', revision: '1' } }),
      video('d', 240, 30, 1, { assetRef: { id: 'asset_x', revision: '1' } }),
      video('e', 270, 30, 2, { assetRef: { id: 'asset_x', revision: '1' } }),
    ]);
    expect(cutSeams(sequence)).toEqual([]);
  });
});

describe('改原文', () => {
  const body = {
    schema: 'baocut.speech/1',
    clock: 'source-asset',
    timescale: 1_000_000,
    speakers: [],
    words: [
      { id: 'w1', start: 0, end: 500_000, text: ' Hello', speaker: 's1', timingQuality: 'aligned' },
      { id: 'w2', start: 500_000, end: 900_000, text: ' world', hidden: false },
      { id: 'w3', start: 1_000_000, end: 9_000_000, text: '第一句话。第二句话，接着说。', timingQuality: 'missing' },
    ],
    sentences: null,
  };

  it('改计时的词保留前导空白与别的字段；改成空等于删掉；没有变化返回 null', () => {
    const next = editWordText(body, 'w1', 'Hi');
    expect((next!.words as unknown[])[0]).toEqual({
      id: 'w1',
      start: 0,
      end: 500_000,
      text: ' Hi',
      speaker: 's1',
      timingQuality: 'aligned',
    });
    expect((next!.words as unknown[])[1]).toEqual(body.words[1]);
    expect(body.words[0]!.text).toBe(' Hello');
    expect(editWordText(body, 'w1', 'Hello')).toBeNull();
    expect((editWordText(body, 'w2', '  ')!.words as Array<{ hidden?: boolean }>)[1]!.hidden).toBe(true);
  });

  it('未计时段拆开的一块只改它自己那一段；读回来词 ID 不变', () => {
    const pieces = readSpeechWords(body)!.words.filter((w) => rawWordId(w.id) === 'w3');
    expect(pieces.map((w) => [w.id, w.text])).toEqual([
      ['w3', '第一句话。'],
      ['w3~2', '第二句话，'],
      ['w3~3', '接着说。'],
    ]);
    const next = editWordText(body, 'w3~2', '第2句话，');
    expect((next!.words as Array<{ text: string }>)[2]!.text).toBe('第一句话。第2句话，接着说。');
    expect(
      readSpeechWords(next)!
        .words.filter((w) => rawWordId(w.id) === 'w3')
        .map((w) => w.id),
    ).toEqual(['w3', 'w3~2', 'w3~3']);
  });

  it('删文字：计时的词标隐藏，未计时段只删选中的块，整段都删了才标隐藏', () => {
    const next = hideWords(body, ['w1', 'w3~2'])!;
    const list = next.words as Array<{ id: string; text: string; hidden?: boolean }>;
    expect(list[0]!.hidden).toBe(true);
    expect(list[2]).toMatchObject({ text: '第一句话。接着说。' });
    expect(list[2]!.hidden).toBeUndefined();
    const all = hideWords(body, ['w3', 'w3~2', 'w3~3'])!;
    expect((all.words as Array<{ hidden?: boolean; text: string }>)[2]).toMatchObject({ hidden: true, text: body.words[2]!.text });
    expect(hideWords({ schema: 'baocut.caption/1' }, ['w1'])).toBeNull();
  });
});

describe('staleCaptions', () => {
  it('由这份转写的旧版本生成、还在时间线上的字幕算过期', () => {
    const speech: DocumentRecord = { id: 'doc_speech', kind: 'speech', name: '转写', currentRevision: '3', revisions: {} };
    const cap = (id: string, revision: string): DocumentRecord => ({
      id,
      kind: 'caption',
      name: id,
      currentRevision: '1',
      revisions: {},
      extensions: { 'baocut.speechCues': { speechDocumentId: 'doc_speech', speechRevision: revision, assetId: 'asset_a' } },
    });
    const documents = { old: cap('old', '2'), fresh: cap('fresh', '3'), unused: cap('unused', '1') };
    const sequence = seq([
      caption('c1', 0, 30, undefined, { documentId: 'old' }),
      caption('c2', 30, 30, undefined, { documentId: 'fresh' }),
    ]);
    expect(staleCaptions(sequence, documents, speech).map((d) => d.id)).toEqual(['old']);
  });
});
