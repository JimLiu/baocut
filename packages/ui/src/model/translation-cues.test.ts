import { describe, expect, it } from 'vitest';
import type { CaptionItem, DocumentRecord, Sequence, Track, VideoItem } from '@baocut/protocol';
import { captionChips } from './caption-tracks.ts';
import { CUE_PARAMS, displayWidth, readSpeechWords, speechCaptionBody } from './speech-cues.ts';
import type { TranslationUnit } from './translation-doc.ts';
import {
  compareOptions,
  followCompare,
  speechOf,
  cueOfUnit,
  derivedFrom,
  pairedOriginal,
  pairedTranslation,
  retextCaption,
  sharedCaptionStyle,
  translationCaptionOperations,
  translationCues,
  TRANSLATION_CAPTION_EXTENSION,
  unbuiltOriginals,
} from './translation-cues.ts';

const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };

function video(id: string, fromFrame: number, durationFrames: number, sourceIn: number): VideoItem {
  return {
    ...base,
    id,
    trackId: 'v1',
    type: 'video',
    span: { fromFrame, durationFrames },
    place: {},
    mode: 'fullscreen',
    assetRef: { id: 'asset', revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: String(Math.round(sourceIn * 1000)), timescale: 1000 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
  };
}

function caption(id: string, trackId: string, documentId: string, extra: Partial<CaptionItem> = {}): CaptionItem {
  return { ...base, id, trackId, type: 'caption', span: { fromFrame: 0, durationFrames: 300 }, documentId, ...extra };
}

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

function sequence(items: Sequence['items'], tracks: Track[] = [track('v1', 0, 'visual')]): Sequence {
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
  };
}

const speechBody = {
  schema: 'baocut.speech/1',
  timescale: 1000,
  sentences: null,
  speakers: [{ id: 'A', name: '主持人' }],
  words: [
    { id: 'w1', start: 0, end: 500, text: '今天', speaker: 'A' },
    { id: 'w2', start: 500, end: 1000, text: '很好。', speaker: 'A' },
    { id: 'w3', start: 2000, end: 2600, text: '我们', speaker: 'A' },
    { id: 'w4', start: 2600, end: 3000, text: '开始。', speaker: 'A' },
  ],
};
const speech = readSpeechWords(speechBody)!;

function unit(id: string, words: string[], text: string, extra: Partial<TranslationUnit> = {}): TranslationUnit {
  return {
    id,
    sourceSentenceId: id.slice(2),
    sourceFingerprint: 'fp',
    naturalText: text,
    alignment: { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: words, textHash: 'h' },
    status: 'draft',
    ...extra,
  };
}

describe('译文 → 字幕条', () => {
  it('时间取原句成员词的时间（素材时钟）；过期与空的单元不出字幕', () => {
    const cues = translationCues(speech, [
      unit('t-s-w1', ['w1', 'w2'], 'It is fine today.'),
      unit('t-s-w3', ['w3', 'w4'], "Let's begin."),
      unit('t-s-x', ['w1'], 'stale', { status: 'stale' }),
      unit('t-s-y', ['w3'], '  '),
    ]);
    expect(cues.map((c) => [c.id, c.text, c.start, c.end, c.speaker])).toEqual([
      ['q-t-s-w1', 'It is fine today.', 0, 1, 'A'],
      ['q-t-s-w3', "Let's begin.", 2, 3, 'A'],
    ]);
  });

  it('长译文按 speech-cues 的规矩切成几条，时间按宽度插值，不跨出原句', () => {
    const long = 'This is a rather long translated sentence, which certainly needs to wrap onto more than one caption line.';
    const cues = translationCues(speech, [unit('t-s-w1', ['w1', 'w2'], long)]);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0]!.id).toBe('q-t-s-w1');
    expect(cues.slice(1).every((c) => /^q-t-s-w1~\d+$/.test(c.id))).toBe(true);
    expect(cues[0]!.start).toBe(0);
    expect(cues[cues.length - 1]!.end).toBe(1);
    expect(cues.map((c) => c.text).join(' ')).toBe(long);
  });

  it('原句的词按 ID 找（没有词时间的段拆出来的 `w~n` 归到 `w`）；一个词也找不到的单元不出', () => {
    const words = readSpeechWords({
      schema: 'baocut.speech/1',
      timescale: 1000,
      sentences: null,
      words: [{ id: 'g1', start: 1000, end: 9000, text: '没有词时间的一大段话，中间有逗号，后半句在这里。还有下一句，也很长很长很长。', timingQuality: 'missing' }],
    })!;
    expect(words.words.length).toBeGreaterThan(1);
    const ids = ['g1'];
    const cues = translationCues(words, [unit('t-s-a', ids, 'One long paragraph.'), unit('t-s-gone', ['nope'], 'Gone.')]);
    // 8 秒一句：超过一条 7 秒的上限，切成两条。
    expect(cues.every((c) => c.id.startsWith('q-t-s-a'))).toBe(true);
    expect([cues[0]!.start, cues.at(-1)!.end]).toEqual([1, 9]);
    expect(cues.map((c) => c.text).join(' ')).toBe('One long paragraph.');
  });

  it('字幕条的归属按边界判：t-s-w1 不吞 t-s-w10', () => {
    expect(cueOfUnit('q-t-s-w1', 't-s-w1')).toBe(true);
    expect(cueOfUnit('q-t-s-w1~3', 't-s-w1')).toBe(true);
    expect(cueOfUnit('q-t-s-w10', 't-s-w1')).toBe(false);
    expect(cueOfUnit('q-t-s-w1-2', 't-s-w1')).toBe(false);
  });
});

describe('译文切条：成对符号里不切，太短的条并进同一句（中文、英文、日文）', () => {
  /** 十个词均匀铺满 `seconds` 秒的原文；对齐到全部十个词的单元，时间就是 [0, seconds]。 */
  const even = (seconds: number) =>
    readSpeechWords({
      ...speechBody,
      words: Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, start: i * seconds * 100, end: (i + 1) * seconds * 100, text: 'x', speaker: 'A' })),
    })!;
  const all = Array.from({ length: 10 }, (_, i) => `e${i}`);
  const cut = (seconds: number, text: string) => translationCues(even(seconds), [unit('t-s-e0', all, text)]);
  const longEnough = (cue: { start: number; end: number }) => cue.end - cue.start >= CUE_PARAMS.minCueDisplaySec - 1e-9;
  const fits = (cue: { text: string }) => displayWidth(cue.text) <= CUE_PARAMS.maxChars + CUE_PARAMS.overflowSlack;

  it('放得进一行的书名号、引号整段留在一条里（中文《》、日文『』、英文弯引号与直引号）；每条不短于 1 秒，拼回去与原文相同', () => {
    for (const [seconds, text, span] of [
      [3, '他认为狄更斯的小说《大卫·科波菲尔》不过是业余作者的粗劣之作，毫无价值。', '《大卫·科波菲尔》'],
      [6, 'ウルフは日記に、ディケンズの『デイヴィッド・コパフィールド』は素人の下手な作品にすぎないと書いた。', '『デイヴィッド・コパフィールド』'],
      [4, 'Woolf’s essay says the novel ‘David Copperfield’ is the clumsy work of an amateur.', '‘David Copperfield’'],
      [6, 'Woolf wrote in her diary that "David Copperfield" was merely the clumsy work of an amateur.', '"David Copperfield"'],
    ] as const) {
      const cues = cut(seconds, text);
      const shown = cues.map((c) => c.text).join('|');
      expect(cues.length, shown).toBeGreaterThan(1);
      expect(cues.some((c) => c.text.includes(span)), shown).toBe(true);
      expect(cues.every(longEnough), shown).toBe(true);
      expect(cues.every(fits), shown).toBe(true);
      expect(cues.map((c) => c.text).join(/[a-z]/i.test(text) ? ' ' : '')).toBe(text);
    }
  });

  it('撇号不当引号：弯撇号（Woolf’s）与直撇号切在同样的地方', () => {
    const curly = cut(6, 'It’s Woolf’s view that Dickens’s novel isn’t worth a reader’s time, and she’s blunt about it.');
    const straight = cut(6, "It's Woolf's view that Dickens's novel isn't worth a reader's time, and she's blunt about it.");
    expect(curly.length).toBeGreaterThan(1);
    expect(curly.map((c) => c.text.replaceAll('’', "'"))).toEqual(straight.map((c) => c.text));
  });

  it('太短的问句并进同一句的下一条（「绞刑架？」可以用满溢出余量）；并不进去时从下一条挪词过来', () => {
    const gallows = '绞刑架？那是一种在大庭广众之下把人处死的可怕刑具。';
    expect(displayWidth(gallows)).toBe(CUE_PARAMS.maxChars + CUE_PARAMS.overflowSlack);
    expect(cut(3, gallows).map((c) => [c.text, c.start, c.end])).toEqual([[gallows, 0, 3]]);
    expect(cut(3, 'Gallows? It is a terrible device for killing people in public.').map((c) => c.text)).toEqual([
      'Gallows? It is a terrible',
      'device for killing people in public.',
    ]);
    const ja = cut(3, '絞首台？それは大勢の前で人を処刑するための恐ろしい道具だ。');
    expect(ja.length).toBe(2);
    expect(ja[0]!.text.startsWith('絞首台？そ')).toBe(true);
    expect(ja.every(longEnough) && ja.every(fits)).toBe(true);
    expect([ja[0]!.start, ja.at(-1)!.end]).toEqual([0, 3]);
  });

  it('整段宽过一行的引号照样在里面切', () => {
    const text = '她说：「这部小说写得像一个业余作者匆匆忙忙拼凑出来的粗劣之作，毫无价值，根本不值得任何人花时间去读」，然后走了。';
    const cues = cut(4, text);
    expect(cues.some((c) => c.text.includes('「') && !c.text.includes('」'))).toBe(true);
    expect(cues.every(fits) && cues.every(longEnough)).toBe(true);
    expect(cues.map((c) => c.text).join('')).toBe(text);
  });

  it('不跨句并：一个单元自己再短也单独成条，各句的时间范围不变', () => {
    const cues = translationCues(even(3), [
      unit('t-s-e0', all.slice(0, 8), 'It is a fine day, so we should all go out for a long walk in the park.'),
      unit('t-s-e8', ['e8'], 'Yes.'),
    ]);
    const of = (id: string) => cues.filter((c) => c.id === `q-${id}` || c.id.startsWith(`q-${id}~`));
    expect(of('t-s-e8').map((c) => [c.text, c.start, c.end])).toEqual([['Yes.', 2.4, 2.7]]);
    expect([of('t-s-e0')[0]!.start, of('t-s-e0').at(-1)!.end]).toEqual([0, 2.4]);
  });
});

describe('改一句译文 → 只换字幕里这一句的几条', () => {
  const units = [unit('t-s-w1', ['w1', 'w2'], 'Fine.'), unit('t-s-w10', ['w3', 'w4'], 'Go.')];
  const body = speechCaptionBody(translationCues(speech, units), speech.speakers);

  it('原处换掉，别的条（含手改过的字）不动', () => {
    const edited = { ...body, cues: (body.cues as Array<Record<string, unknown>>).map((c) => (c.id === 'q-t-s-w10' ? { ...c, text: 'Go!!' } : c)) };
    const fresh = translationCues(speech, [unit('t-s-w1', ['w1', 'w2'], 'It is a very fine day today, my friends, a truly lovely one.')]);
    const next = retextCaption(edited, 't-s-w1', fresh, speech.speakers);
    const cues = next.cues as Array<{ id: string; text: string; start: number; end: number }>;
    expect(cues.at(-1)).toMatchObject({ id: 'q-t-s-w10', text: 'Go!!', start: 2000, end: 3000 });
    expect(cues.slice(0, -1).every((c) => c.id.startsWith('q-t-s-w1') && c.end <= 1000)).toBe(true);
    expect(cues.length).toBeGreaterThan(2);
    expect(next.schema).toBe('baocut.caption/1');
  });

  it('改成空的就去掉这一句；原来没有的按时间插进去', () => {
    const removed = retextCaption(body, 't-s-w1', [], speech.speakers);
    expect((removed.cues as Array<{ id: string }>).map((c) => c.id)).toEqual(['q-t-s-w10']);
    const back = retextCaption(removed, 't-s-w1', translationCues(speech, [units[0]!]), speech.speakers);
    expect((back.cues as Array<{ id: string }>).map((c) => c.id)).toEqual(['q-t-s-w1', 'q-t-s-w10']);
  });
});

const doc = (id: string, kind: string, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id,
  kind,
  name: id,
  currentRevision: '1',
  revisions: {},
  ...extra,
});

describe('放到画面上的事务', () => {
  const documents: Record<string, DocumentRecord> = {
    speech: doc('speech', 'speech'),
    trans: doc('trans', 'translation', { sourceDocumentId: 'speech', language: 'en' }),
    orig: doc('orig', 'caption', { sourceDocumentId: 'speech' }),
    srt: doc('srt', 'caption'),
    style: doc('style', 'caption-style'),
  };
  const body = { schema: 'baocut.caption/1', clock: 'source-asset', timescale: 1000, cues: [{ id: 'q-1', start: 1000, end: 2500, text: 'Hi' }] };
  const source = {
    translationDocumentId: 'trans',
    translationRevision: '1',
    speechDocumentId: 'speech',
    speechRevision: '3',
    assetId: 'asset',
    language: 'en',
    name: '译文 · 英语',
  };
  const tracks = [track('v1', 0, 'visual'), track('s1', 1, 'subtitle'), track('s2', 2, 'subtitle')];

  it('双语、原文没有样式：新建一份默认样式，原文与译文一起用上；新轨、文档、实例在同一笔里', () => {
    const seq = sequence([caption('srt-1', 's2', 'srt'), caption('o1', 's1', 'orig'), caption('o2', 's1', 'orig')], tracks);
    // 时间线上没有取用这个素材的实例：不写作用实例，区间盖住第一条到最后一条。
    const chips = captionChips(seq, documents);
    const paired = pairedOriginal(chips, documents, 'speech');
    expect(paired?.documentId).toBe('orig');
    const ops = translationCaptionOperations(seq, body, { ...source, bilingual: true }, paired);
    expect(ops.map((op) => op.type)).toEqual(['addTrack', 'putDocument', 'putDocument', 'setCaptionStyle', 'setCaptionStyle', 'insertItems']);
    expect(ops[0]).toMatchObject({ kind: 'subtitle', ref: 'translation-track', name: '译文 · 英语' });
    expect(ops[1]).toMatchObject({
      kind: 'caption',
      language: 'en',
      sourceAsset: { assetId: 'asset' },
      sourceDocument: { documentId: 'trans' },
      summary: { cueCount: 1 },
      extensions: { [TRANSLATION_CAPTION_EXTENSION]: { translationDocumentId: 'trans', speechRevision: '3', assetId: 'asset' } },
    });
    expect(ops[2]).toMatchObject({ kind: 'caption-style', ref: 'translation-style' });
    expect(ops.slice(3, 5).map((op) => (op as { itemId: string }).itemId)).toEqual(['o1', 'o2']);
    expect(ops[5]).toMatchObject({
      items: [{ type: 'caption', documentRef: 'translation-caption', trackRef: 'translation-track', styleDocumentRef: 'translation-style', span: { fromFrame: 30, durationFrames: 45 } }],
    });
    expect((ops[5] as { items: object[] }).items[0]).not.toHaveProperty('scopeItemIds');
  });

  it('素材时钟：作用实例是时间线上取用这个素材的实例，区间盖住它们（同生成的原文字幕）', () => {
    const seq = sequence([video('b', 90, 60, 5), video('a', 0, 30, 0)], tracks);
    const ops = translationCaptionOperations(seq, body, { ...source, bilingual: false }, null);
    expect(ops.at(-1)).toMatchObject({ items: [{ scopeItemIds: ['a', 'b'], span: { fromFrame: 0, durationFrames: 150 } }] });
  });

  it('双语、原文有样式：共用它；原文被拿下的放回来', () => {
    const seq = sequence([caption('o1', 's1', 'orig', { styleDocumentId: 'style', enabled: false })], tracks);
    const paired = pairedOriginal(captionChips(seq, documents), documents, 'speech');
    const ops = translationCaptionOperations(seq, body, { ...source, bilingual: true }, paired);
    expect(ops.map((op) => op.type)).toEqual(['addTrack', 'putDocument', 'updateItem', 'insertItems']);
    expect(ops[2]).toMatchObject({ itemId: 'o1', enabled: true });
    expect(ops[3]).toMatchObject({ items: [{ styleDocumentId: 'style' }] });
  });

  it('只看译文：原文从画面上拿下（不删）；锁住的原文不动', () => {
    const seq = sequence([caption('o1', 's1', 'orig')], tracks);
    const paired = pairedOriginal(captionChips(seq, documents), documents, 'speech');
    const ops = translationCaptionOperations(seq, body, { ...source, bilingual: false }, paired);
    expect(ops.map((op) => op.type)).toEqual(['addTrack', 'putDocument', 'updateItem', 'insertItems']);
    expect(ops[2]).toMatchObject({ itemId: 'o1', enabled: false });
    expect((ops[3] as { items: object[] }).items[0]).not.toHaveProperty('styleDocumentRef');

    const locked = sequence([caption('o1', 's1', 'orig', { locked: true })], tracks);
    const lockedPair = pairedOriginal(captionChips(locked, documents), documents, 'speech');
    expect(translationCaptionOperations(locked, body, { ...source, bilingual: true }, lockedPair).map((op) => op.type)).toEqual([
      'addTrack',
      'putDocument',
      'insertItems',
    ]);
  });

  it('配对：同一份转写生成的优先，其次画面上的第一条原文；只认从这份译文生成的字幕', () => {
    const seq = sequence([caption('srt-1', 's2', 'srt')], tracks);
    expect(pairedOriginal(captionChips(seq, documents), documents, 'speech')?.documentId).toBe('srt');
    expect(pairedOriginal([], documents, 'speech')).toBeNull();
    const ours = doc('cap', 'caption', { sourceDocumentId: 'trans', extensions: { [TRANSLATION_CAPTION_EXTENSION]: { translationDocumentId: 'trans' } } });
    expect(derivedFrom(ours, 'trans')).toBe(true);
    expect(derivedFrom(doc('cap2', 'caption', { sourceDocumentId: 'trans' }), 'trans')).toBe(false);
  });
});

describe('只有译文字幕时用转写建原文层（虚线「原文」chip）', () => {
  const documents: Record<string, DocumentRecord> = {
    speech: doc('speech', 'speech', { sourceAssetId: 'asset', name: '访谈.mp4' }),
    trans: doc('trans', 'translation', { sourceDocumentId: 'speech', language: 'en' }),
    enCap: doc('enCap', 'caption', { sourceDocumentId: 'trans', language: 'en' }),
    orig: doc('orig', 'caption', { sourceDocumentId: 'speech' }),
    old: doc('old', 'speech', { sourceAssetId: 'asset' }),
  };
  const tracks = [track('v1', 0, 'visual'), track('s1', 1, 'subtitle'), track('s2', 2, 'subtitle')];

  it('译文字幕顺着派生找到的转写没有原文字幕：列出它，配上那条译文；没有译文字幕的旧转写不列', () => {
    const seq = sequence([caption('e1', 's1', 'enCap', { styleDocumentId: 'style' })], tracks);
    const chips = captionChips(seq, documents);
    expect(unbuiltOriginals(chips, documents)).toEqual([
      { speechDocumentId: 'speech', assetId: 'asset', name: '访谈.mp4', translation: expect.objectContaining({ documentId: 'enCap' }) },
    ]);
    expect(pairedTranslation(chips, documents, 'speech')?.documentId).toBe('enCap');
    expect(pairedTranslation(chips, documents, 'old')).toBeNull();
  });

  it('原文字幕已经有了（拿下的也算）：不列', () => {
    const seq = sequence([caption('e1', 's1', 'enCap'), caption('o1', 's2', 'orig', { enabled: false })], tracks);
    expect(unbuiltOriginals(captionChips(seq, documents), documents)).toEqual([]);
  });

  it('共用样式：译文有样式就用它；没有就新建一份，译文一起换上；译文锁住且没样式时各用各的', () => {
    const styled = captionChips(sequence([caption('e1', 's1', 'enCap', { styleDocumentId: 'style' })], tracks), documents)[0]!;
    expect(sharedCaptionStyle(sequence([], tracks), styled)).toEqual({ operations: [], style: { styleDocumentId: 'style' } });

    const bare = captionChips(sequence([caption('e1', 's1', 'enCap')], tracks), documents)[0]!;
    const fresh = sharedCaptionStyle(sequence([], tracks), bare);
    expect(fresh.operations.map((op) => op.type)).toEqual(['putDocument', 'setCaptionStyle']);
    expect(fresh.operations[1]).toMatchObject({ itemId: 'e1', styleDocument: { ref: 'original-style' } });
    expect(fresh.style).toEqual({ styleDocumentRef: 'original-style' });

    const locked = captionChips(sequence([caption('e1', 's1', 'enCap', { locked: true })], tracks), documents)[0]!;
    expect(sharedCaptionStyle(sequence([], tracks), locked)).toEqual({ operations: [], style: null });
  });
});

describe('对照条跟着校对中的那段', () => {
  const record = (id: string, kind: string, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({ id, kind, name: id, currentRevision: '1', revisions: {}, ...extra });
  const documents: Record<string, DocumentRecord> = {
    sa: record('sa', 'speech'),
    sb: record('sb', 'speech'),
    ta: record('ta', 'translation', { language: 'zh-CN', sourceDocumentId: 'sa' }),
    tb: record('tb', 'translation', { language: 'zh-CN', sourceDocumentId: 'sb' }),
    tb2: record('tb2', 'translation', { language: 'zh-CN', sourceDocumentId: 'sb' }),
    ja: record('ja', 'translation', { language: 'ja', sourceDocumentId: 'sa' }),
    ca: record('ca', 'caption', { sourceDocumentId: 'sa' }),
    cta: record('cta', 'caption', { sourceDocumentId: 'ta' }),
  };
  const translations = [documents.ta!, documents.tb!, documents.tb2!, documents.ja!];

  it('字幕文档追到转写：原文直接、译文隔一层；导入的追不到', () => {
    expect(speechOf('ca', documents)).toBe('sa');
    expect(speechOf('cta', documents)).toBe('sa');
    expect(speechOf('missing', documents)).toBeNull();
  });

  it('每门语言只列与这段同源的；这段没有时列正在对照的；同源重翻的都列', () => {
    expect(compareOptions(translations, 'sa', null).map((d) => d.id)).toEqual(['ta', 'ja']);
    expect(compareOptions(translations, 'sb', null).map((d) => d.id)).toEqual(['tb', 'tb2', 'ja']);
    expect(compareOptions(translations, 'sx', documents.tb!).map((d) => d.id)).toEqual(['tb', 'tb2', 'ja']);
    expect(compareOptions(translations, null, null).map((d) => d.id)).toEqual(['ta', 'ja']);
  });

  it('换段时同一门语言跟过去；已同源或这段没有这门时不动', () => {
    expect(followCompare(translations, 'sb', documents.ta!)?.id).toBe('tb');
    expect(followCompare(translations, 'sa', documents.ta!)).toBeNull();
    expect(followCompare(translations, 'sb', documents.ja!)).toBeNull();
    expect(followCompare(translations, null, documents.ta!)).toBeNull();
  });
});
