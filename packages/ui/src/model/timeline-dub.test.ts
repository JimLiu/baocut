import { describe, expect, it } from 'vitest';
import type { AssetRecord, AudioItem, DocumentRecord, Sequence, Track } from '@baocut/protocol';
import {
  anyLocked,
  dubBlocks,
  dubGroups,
  dubMark,
  dubTempo,
  dubTrackGroup,
  groupLocked,
  muteOperations,
  planRecordOf,
  planUnits,
  roomAfter,
  selectedBlocks,
  sentenceSpeakers,
  speakerHue,
  stemTrackOf,
  stretchChanged,
  stretchSpeed,
} from './timeline-dub.ts';
import { trackCounts } from './dub-takes.ts';

const fps = { num: 30, den: 1 };

function track(id: string, order: number): Track {
  return { id, order, kind: 'audio', locked: false, visible: true, muted: false, solo: { enabled: false, group: 'audio' } };
}

/** 按秒放的音频；`dub` 给了就是配音块。 */
function audio(id: string, trackId: string, start: number, seconds: number, extra: Partial<AudioItem> = {}): AudioItem {
  return {
    id,
    trackId,
    type: 'audio',
    enabled: true,
    locked: false,
    paintOrder: 0,
    followPolicy: { kind: 'sequence-fixed' },
    assetRef: { id: `asset_${id}`, revision: '1' },
    fromFrame: Math.round(start * 30),
    subframeOffset: { ticks: '0', timescale: 1000 },
    playDuration: { ticks: String(Math.round(seconds * 1000)), timescale: 1000 },
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
    mix: { volume: 1 },
    ...extra,
  };
}

const dub = (groupId: string, unitId: string, language = 'en') => ({ role: 'dub' as const, extensions: { 'baocut.dub': { groupId, language, unitId } } });

function sequence(items: Sequence['items'], tracks = [track('a-orig', 0), track('a-dub', 1)]): Sequence {
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

const seq = sequence([
  audio('orig', 'a-orig', 0, 20, { mix: { volume: 1, muted: true } }),
  audio('d2', 'a-dub', 5, 2, dub('g1', 'u2')),
  audio('d1', 'a-dub', 1, 3, { ...dub('g1', 'u1'), mix: { volume: 1, muted: true } }),
  audio('bg', 'a-orig', 20, 5, { extensions: { 'baocut.dub': { groupId: 'g1', stem: 'background' } } }),
  audio('d3', 'a-dub', 9, 1.5, { ...dub('g1', 'u3'), timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 6, den: 5 } } }),
]);

function asset(id: string, tempo?: number): AssetRecord {
  return {
    id,
    kind: 'audio',
    name: id,
    currentRevision: '1',
    revisions: {
      '1': {
        revision: '1',
        storage: { kind: 'managed', path: `${id}.wav` },
        provenance: { origin: 'generated', source: tempo === undefined ? { kind: 'tts' } : { kind: 'tts', tempo } },
      },
    },
  } as unknown as AssetRecord;
}

const assets = { asset_d1: asset('asset_d1'), asset_d2: asset('asset_d2', 1.25), asset_d3: asset('asset_d3', 1.2) };

const speech = {
  schema: 'baocut.speech/1',
  speakers: [
    { id: 'S1', name: '主持人' },
    { id: 'S2', name: '嘉宾' },
  ],
  words: [
    { id: 'w1', start: 0, end: 1, text: '你好。', speaker: 'S1' },
    { id: 'w2', start: 1, end: 2, text: '欢迎。', speaker: 'S2' },
    { id: 'w3', start: 2, end: 3, text: '嗯', speaker: 'S1', hidden: true },
    { id: 'w4', start: 3, end: 4, text: '谢谢。', speaker: 'S2' },
  ],
};

const unit = (unitId: string, sentenceId: string, textValue: string, status = 'ready') => ({
  id: `d-${unitId}`,
  sourceSentenceIds: [sentenceId],
  script: { text: textValue },
  status,
  targetAnchor: { kind: 'sentence', speechRef: { id: 'speech1', revision: '1' }, sentenceId },
  extensions: { 'baocut.dub': { translationUnitId: unitId } },
});

const plan = {
  units: [unit('u1', 's-w1', 'Hello.'), unit('u2', 's-w2', 'Welcome.'), unit('u3', 's-w3', 'Thanks.', 'needs-fit')],
  extensions: { 'baocut.dub': { mutedItemIds: ['orig'] } },
};

describe('认配音块与组', () => {
  it('只有带 groupId 的音频算配音块，分离出来的背景不算', () => {
    expect(dubMark(seq.items[1]!)).toEqual({ groupId: 'g1', language: 'en', unitId: 'u2' });
    expect(dubMark(seq.items[3]!)).toBeNull();
    expect(dubMark(seq.items[0]!)).toBeNull();
  });

  it('组里的块按时间先后；只放这一组的轨道才写「配音 · 语言」', () => {
    expect(dubGroups(seq)).toEqual([{ groupId: 'g1', language: 'en', itemIds: ['d1', 'd2', 'd3'], trackIds: ['a-dub'] }]);
    expect(dubTrackGroup(seq, 'a-dub')?.groupId).toBe('g1');
    expect(dubTrackGroup(seq, 'a-orig')).toBeNull();
    expect(dubTrackGroup(seq, 'empty')).toBeNull();
  });

  it('只放一组分离出的同一种分轨的轨道才认作「背景声」「人声」行，语言取这组配音的', () => {
    const stem = (s: string, groupId = 'g1') => ({ extensions: { 'baocut.dub': { groupId, stem: s } } });
    const sep = sequence(
      [
        audio('d1', 'a-dub', 1, 3, dub('g1', 'u1', 'ja')),
        audio('bg1', 'a-bg', 0, 10, stem('background')),
        audio('bg2', 'a-bg', 10, 10, stem('background')),
        audio('v1', 'a-voc', 0, 10, stem('vocals')),
        audio('x1', 'a-mix', 0, 10, stem('vocals')),
        audio('x2', 'a-mix', 10, 10, stem('background')),
        audio('o1', 'a-other', 0, 10, stem('background', 'g9')),
      ],
      [track('a-dub', 0), track('a-bg', 1), track('a-voc', 2), track('a-mix', 3), track('a-other', 4)],
    );
    expect(stemTrackOf(sep, 'a-bg')).toEqual({ stem: 'background', groupId: 'g1', language: 'ja' });
    expect(stemTrackOf(sep, 'a-voc')).toEqual({ stem: 'vocals', groupId: 'g1', language: 'ja' });
    expect(stemTrackOf(sep, 'a-mix')).toBeNull();
    expect(stemTrackOf(sep, 'a-dub')).toBeNull();
    expect(stemTrackOf(sep, 'a-other')).toEqual({ stem: 'background', groupId: 'g9', language: null });
    expect(stemTrackOf(sep, 'empty')).toBeNull();
  });

  it('配音计划按当前版本概要里的 groupId 认', () => {
    const record = (id: string, kind: string, groupId: string) =>
      ({
        id,
        kind,
        name: id,
        currentRevision: '2',
        revisions: { '1': { summary: { groupId: 'old' } }, '2': { summary: { groupId } } },
      }) as unknown as DocumentRecord;
    const documents = { a: record('a', 'dubbing-plan', 'g0'), b: record('b', 'speech', 'g1'), c: record('c', 'dubbing-plan', 'g1') };
    expect(planRecordOf(documents, 'g1')?.id).toBe('c');
    expect(planRecordOf(documents, 'old')).toBeNull();
  });
});

describe('计划、说话人与语速', () => {
  it('计划单元按译文单元认，旧的退回 d-<unitId>', () => {
    const units = planUnits({ units: [unit('u1', 's-w1', 'Hello.'), { id: 'd-u9', script: { text: 'Old.' }, sourceSentenceIds: ['s-w4'] }, 'junk'] });
    expect(units.get('u1')).toEqual({ unitId: 'u1', text: 'Hello.', sentenceId: 's-w1', speechId: 'speech1', status: 'ready' });
    expect(units.get('u9')).toMatchObject({ text: 'Old.', sentenceId: 's-w4', speechId: null });
    expect(planUnits(null).size).toBe(0);
  });

  it('句子的说话人取第一个没隐藏的词的；次序跟转写', () => {
    const index = sentenceSpeakers(speech)!;
    expect(index.order).toEqual(['S1', 'S2']);
    expect(index.bySentence.get('s-w1')).toBe('S1');
    expect(index.bySentence.get('s-w2')).toBe('S2');
    expect(sentenceSpeakers({ schema: 'baocut.caption/1' })).toBeNull();
  });

  it('色相按说话人次序轮转', () => {
    expect(speakerHue(0)).toBe('blue');
    expect(speakerHue(1)).toBe('green');
    expect(speakerHue(6)).toBe('blue');
  });

  it('语速 = 合成时对齐加的速 × 实例的变速', () => {
    expect(dubTempo(seq.items[2] as AudioItem, assets)).toBe(1);
    expect(dubTempo(seq.items[1] as AudioItem, assets)).toBe(1.25);
    expect(dubTempo(seq.items[1] as AudioItem, {})).toBe(1);
  });

  it('每块的外观：说话人色相、译文、语速、过快、静音、手动', () => {
    const blocks = dubBlocks(seq, { assets, plans: new Map([['g1', plan]]), speeches: new Map([['speech1', speech]]) });
    expect([...blocks.keys()]).toEqual(['d1', 'd2', 'd3']);
    expect(blocks.get('d1')).toMatchObject({
      index: 1,
      text: 'Hello.',
      speakerId: 'S1',
      speakerName: '主持人',
      hue: 'blue',
      rate: 1,
      fast: false,
      muted: true,
      manual: false,
    });
    expect(blocks.get('d2')).toMatchObject({ index: 2, text: 'Welcome.', speakerId: 'S2', hue: 'green', rate: 1.25, fast: false, muted: false });
    // 1.2 × 1.2 = 1.44 > 1.35；句子 s-w3 里只有隐藏的词，说话人取不到
    const d3 = blocks.get('d3')!;
    expect(d3.rate).toBeCloseTo(1.44);
    expect(d3).toMatchObject({ fast: true, manual: true, speakerId: null, hue: 'blue' });
    expect(trackCounts(blocks.values(), [], new Set())).toEqual({ total: 3, fast: 1, muted: 1, failed: 0, queued: 0 });
  });

  it('计划与转写还没取到：块照画，色相取第一档、文字留给片段名', () => {
    const blocks = dubBlocks(seq, { assets: {}, plans: new Map(), speeches: new Map() });
    expect(blocks.get('d2')).toMatchObject({ text: null, speakerId: null, hue: 'blue', rate: 1, fast: false });
  });
});

describe('拖右缘改语速', () => {
  const d1 = seq.items[2] as AudioItem; // 1–4 秒，后面 d2 从 5 秒起
  const d3 = seq.items[4] as AudioItem; // 9–10.5 秒，1.2 倍，后面没有东西

  it('到同轨下一件起点还有多少空', () => {
    expect(roomAfter(seq, d1)).toBeCloseTo(4);
    expect(roomAfter(seq, d3)).toBeNull();
  });

  it('拉短变快、拉长变慢，取到两位小数并约分', () => {
    expect(stretchSpeed(d1, 2.4, 4)).toMatchObject({ rate: { num: 5, den: 4 }, speed: 1.25, clamped: false });
    expect(stretchSpeed(d1, 2.4, 4).seconds).toBeCloseTo(2.4);
    expect(stretchSpeed(d1, 3.75, 4)).toMatchObject({ rate: { num: 4, den: 5 }, speed: 0.8 });
    // 已经 1.2 倍的块：源长 1.8 秒，拉到 1 秒就是 1.8 倍
    expect(stretchSpeed(d3, 1, null)).toMatchObject({ rate: { num: 9, den: 5 }, speed: 1.8 });
  });

  it('拉长不能盖住下一件：速率往上取一档，宁可短一点', () => {
    const s = stretchSpeed(d1, 10, 4);
    // 源长 3 秒、空 4 秒 → 最慢 0.75 倍，正好 4 秒
    expect(s).toMatchObject({ speed: 0.75, clamped: true });
    expect(s.seconds).toBeLessThanOrEqual(4);
    // 空 3.7 秒：3 / 3.7 = 0.8108… → 0.82 倍，2.0 ≤ 3.7
    const t = stretchSpeed(d1, 10, 3.7);
    expect(t.speed).toBe(0.82);
    expect(t.seconds).toBeLessThanOrEqual(3.7);
  });

  it('夹在合同的 0.1–10 之内', () => {
    expect(stretchSpeed(d1, 0.01, 4)).toMatchObject({ speed: 10, clamped: true });
    expect(stretchSpeed(d1, 1000, null)).toMatchObject({ speed: 0.1, rate: { num: 1, den: 10 }, clamped: true });
    // 空太小，最快也放不下：保持原样
    expect(stretchSpeed(d1, 1, 0.1)).toMatchObject({ speed: 1, seconds: 3, clamped: true });
  });

  it('速率没变就不提交', () => {
    expect(stretchChanged(d1, stretchSpeed(d1, 3, 4))).toBe(false);
    expect(stretchChanged(d1, stretchSpeed(d1, 2, 4))).toBe(true);
  });
});

describe('菜单操作', () => {
  const blocks = dubBlocks(seq, { assets, plans: new Map(), speeches: new Map() });

  it('选区里的配音块，别的实例不管', () => {
    expect(selectedBlocks(['orig', 'd2', 'd1'], blocks).map((b) => b.itemId)).toEqual(['d2', 'd1']);
  });

  it('静音只发状态真的要变的那几件', () => {
    expect(muteOperations(seq, ['d1', 'd2'], true)).toEqual([{ type: 'setAudioMix', sequenceId: 'seq', itemId: 'd2', muted: true }]);
    expect(muteOperations(seq, ['d1', 'd2'], false)).toEqual([{ type: 'setAudioMix', sequenceId: 'seq', itemId: 'd1', muted: false }]);
  });

  it('锁着的（实例或轨道）不能改：整组里有一件锁着就不能移除', () => {
    expect(anyLocked(seq, ['d1', 'd2'])).toBe(false);
    expect(groupLocked(seq, 'g1')).toBe(false);
    const itemLocked = sequence(seq.items.map((item) => (item.id === 'd2' ? { ...item, locked: true } : item)));
    expect(anyLocked(itemLocked, ['d1'])).toBe(false);
    expect(anyLocked(itemLocked, ['d1', 'd2'])).toBe(true);
    // 背景声在原声轨上：原声轨锁了，整组就移除不了
    const origLocked = sequence(seq.items, [{ ...track('a-orig', 0), locked: true }, track('a-dub', 1)]);
    expect(anyLocked(origLocked, ['d1', 'd2', 'd3'])).toBe(false);
    expect(groupLocked(origLocked, 'g1')).toBe(true);
  });
});
