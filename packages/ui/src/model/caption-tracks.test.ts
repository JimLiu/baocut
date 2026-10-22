import { describe, expect, it } from 'vitest';
import type { CaptionItem, DocumentRecord, Sequence, Track } from '@baocut/protocol';
import { captionChips, captionGroups, dropOperations, flipTargets, groupOf, languageName, onScreen, putBackOperations, segmentAt, segmentSource } from './caption-tracks.ts';

const base = { enabled: true, locked: false, paintOrder: 0, followPolicy: { kind: 'sequence-fixed' as const } };

const track = (id: string, order: number, extra: Partial<Track> = {}): Track => ({
  id,
  order,
  kind: 'subtitle',
  locked: false,
  visible: true,
  muted: false,
  solo: { enabled: false, group: 'visual' },
  ...extra,
});

function caption(id: string, trackId: string, documentId: string, fromFrame = 0, extra: Partial<CaptionItem> = {}): CaptionItem {
  return { ...base, id, trackId, type: 'caption', span: { fromFrame, durationFrames: 30 }, documentId, ...extra };
}

function doc(id: string, kind: string, name: string, extra: Partial<DocumentRecord> = {}): DocumentRecord {
  return { id, kind, name, currentRevision: '1', revisions: {}, ...extra };
}

function sequence(tracks: Track[], items: Sequence['items']): Sequence {
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

const documents: Record<string, DocumentRecord> = {
  speech: doc('speech', 'speech', '转写'),
  trans: doc('trans', 'translation', '英文译文', { language: 'en' }),
  orig: doc('orig', 'caption', '访谈', { sourceDocumentId: 'speech', language: 'zh' }),
  en: doc('en', 'caption', '访谈 English', { sourceDocumentId: 'trans', language: 'en' }),
  other: doc('other', 'caption', '旁白'),
};

describe('字幕轨条', () => {
  it('每条轨上的每份字幕一枚 chip：原文写「原文」，译文写语言名；切开的几段算一枚', () => {
    const seq = sequence(
      [track('s2', 2), track('s1', 1)],
      [caption('c3', 's2', 'en'), caption('c2', 's1', 'orig', 60), caption('c1', 's1', 'orig', 0)],
    );
    const chips = captionChips(seq, documents);
    expect(chips.map((chip) => [chip.label, chip.itemIds, chip.kind, chip.state])).toEqual([
      ['原文', ['c1', 'c2'], 'original', 'on'],
      ['English', ['c3'], 'translation', 'on'],
    ]);
  });

  it('同名的补上文档名；拿下的、轨被停用的、锁住的各有状态', () => {
    const seq = sequence(
      [track('s1', 1), track('s2', 2, { visible: false }), track('s3', 3, { locked: true })],
      [caption('a', 's1', 'orig'), caption('b', 's2', 'other'), caption('c', 's3', 'en', 0, { enabled: false })],
    );
    const chips = captionChips(seq, documents);
    expect(chips.map((chip) => [chip.label, chip.state, chip.locked])).toEqual([
      ['原文（访谈）', 'on', false],
      ['原文（旁白）', 'off', false],
      ['English', 'shelved', true],
    ]);
    expect(onScreen(chips).map((chip) => chip.documentId)).toEqual(['orig', 'other']);
  });

  it('文档不在的实例不列；语言名认不出时原样', () => {
    expect(captionChips(sequence([track('s1', 1)], [caption('x', 's1', 'missing')]), documents)).toEqual([]);
    expect(languageName('ja')).toBe('日本語');
    expect(languageName('!!')).toBe('!!');
  });

  it('拿下：最后一条拒绝；否则把这枚的每段都停用', () => {
    const one = sequence([track('s1', 1)], [caption('a', 's1', 'orig'), caption('b', 's1', 'other', 60, { enabled: false })]);
    const chips = captionChips(one, documents);
    expect(dropOperations(one, chips, chips[0]!)).toEqual({ refused: 'last' });
    const two = sequence([track('s1', 1), track('s2', 2)], [caption('a', 's1', 'orig'), caption('a2', 's1', 'orig', 60), caption('b', 's2', 'en')]);
    const both = captionChips(two, documents);
    expect(dropOperations(two, both, both[0]!)).toEqual({
      operations: [
        { type: 'updateItem', sequenceId: 'seq', itemId: 'a', enabled: false },
        { type: 'updateItem', sequenceId: 'seq', itemId: 'a2', enabled: false },
      ],
    });
  });

  it('放回：画面上已有两条时问一次（放回后三条）', () => {
    const seq = sequence(
      [track('s1', 1), track('s2', 2), track('s3', 3)],
      [caption('a', 's1', 'orig'), caption('b', 's2', 'en', 0, { enabled: false }), caption('c', 's3', 'other', 0, { enabled: false })],
    );
    const chips = captionChips(seq, documents);
    expect(putBackOperations(seq, chips, chips[1]!)).toEqual({
      confirm: null,
      operations: [{ type: 'updateItem', sequenceId: 'seq', itemId: 'b', enabled: true }],
    });
    const after = captionChips(
      sequence(seq.tracks, [caption('a', 's1', 'orig'), caption('b', 's2', 'en'), caption('c', 's3', 'other', 0, { enabled: false })]),
      documents,
    );
    expect(putBackOperations(seq, after, after[2]!).confirm).toBe(3);
  });

  it('倒转：只有原文与译文共用一份样式、都在画面上时才有目标', () => {
    const shared = sequence(
      [track('s1', 1), track('s2', 2)],
      [caption('a', 's1', 'orig', 0, { styleDocumentId: 'st' }), caption('b', 's2', 'en', 0, { styleDocumentId: 'st' })],
    );
    expect(flipTargets(captionChips(shared, documents))).toEqual(['st']);
    const apart = sequence(
      [track('s1', 1), track('s2', 2)],
      [caption('a', 's1', 'orig', 0, { styleDocumentId: 'st' }), caption('b', 's2', 'en', 0, { styleDocumentId: 'st2' })],
    );
    expect(flipTargets(captionChips(apart, documents))).toEqual([]);
    const originals = sequence(
      [track('s1', 1), track('s2', 2)],
      [caption('a', 's1', 'orig', 0, { styleDocumentId: 'st' }), caption('b', 's2', 'other', 0, { styleDocumentId: 'st' })],
    );
    expect(flipTargets(captionChips(originals, documents))).toEqual([]);
  });

  it('倒转：每段素材一对原文与译文、各一份样式时一起倒转', () => {
    const seq = sequence(
      [track('s1', 1), track('s2', 2)],
      [
        caption('a', 's1', 'orig', 0, { styleDocumentId: 'st' }),
        caption('b', 's2', 'en', 0, { styleDocumentId: 'st' }),
        caption('c', 's1', 'clipEn', 90, { styleDocumentId: 'st2' }),
        caption('d', 's2', 'clipZh', 90, { styleDocumentId: 'st2' }),
      ],
    );
    expect(flipTargets(captionChips(seq, { ...documents, ...clips }))).toEqual(['st', 'st2']);
  });
});

const clips: Record<string, DocumentRecord> = {
  n1: doc('n1', 'caption', 'Subtitles', { language: 'zh-CN' }),
  n2: doc('n2', 'caption', 'Subtitles', { language: 'zh-CN' }),
  i1: doc('i1', 'caption', 'Subtitles', { language: 'en' }),
  i2: doc('i2', 'caption', 'Subtitles', { language: 'en' }),
  tr1: doc('tr1', 'translation', '实拍 1 (zh-CN)', { language: 'zh-CN' }),
  tr2: doc('tr2', 'translation', '实拍 2 (zh-CN)', { language: 'zh-CN' }),
  t1: doc('t1', 'caption', '中文（中国）', { sourceDocumentId: 'tr1', language: 'zh-CN' }),
  t2: doc('t2', 'caption', '中文（中国）', { sourceDocumentId: 'tr2', language: 'zh-CN' }),
  clipEn: doc('clipEn', 'caption', 'Subtitles', { language: 'en' }),
  clipZh: doc('clipZh', 'caption', '中文（中国）', { sourceDocumentId: 'tr1', language: 'zh-CN' }),
};

describe('轨条分组', () => {
  // 纪录片的形态：旁白一段一份、实拍一段一份并各有译文，散在好几条轨上。
  const seq = sequence(
    [track('nar', 1), track('i1t', 2), track('i2t', 3), track('t1t', 4), track('t2t', 5)],
    [
      caption('n2a', 'nar', 'n2', 300),
      caption('n1a', 'nar', 'n1', 0),
      caption('i1a', 'i1t', 'i1', 100, { span: { fromFrame: 100, durationFrames: 1000 }, styleDocumentId: 's1' }),
      caption('i2a', 'i2t', 'i2', 120, { span: { fromFrame: 120, durationFrames: 50 }, styleDocumentId: 's2' }),
      caption('t1a', 't1t', 't1', 100, { span: { fromFrame: 100, durationFrames: 1000 }, styleDocumentId: 's1' }),
      caption('t2a', 't2t', 't2', 120, { span: { fromFrame: 120, durationFrames: 50 }, styleDocumentId: 's2', enabled: false }),
    ],
  );
  const chips = captionChips(seq, clips);
  const groups = captionGroups(seq, chips, clips);

  it('按原文 / 译文 ＋ 语言并成组：原文有几门时带语言，译文写语言名，段按开始时刻排', () => {
    expect(chips).toHaveLength(6);
    expect(groups.map((group) => [group.label, group.segments.map((chip) => chip.documentId), group.state])).toEqual([
      ['原文（中文）', ['n1', 'n2'], 'on'],
      ['原文（English）', ['i1', 'i2'], 'on'],
      ['中文', ['t1', 't2'], 'on'],
    ]);
    expect(groups[1]!.styleDocumentIds).toEqual(['s1', 's2']);
    expect(groupOf(groups, chips.find((chip) => chip.documentId === 't2')!.key)?.key).toBe(groups[2]!.key);
  });

  it('拿下、放回对整组：画面上的组数算软上限', () => {
    expect(dropOperations(seq, groups, groups[0]!)).toEqual({
      operations: ['n1a', 'n2a'].map((itemId) => ({ type: 'updateItem', sequenceId: 'seq', itemId, enabled: false })),
    });
    expect(putBackOperations(seq, groups, groups[2]!).confirm).toBe(3);
  });

  it('一门语言只有一份时名字照旧', () => {
    const plain = sequence([track('s1', 1), track('s2', 2)], [caption('a', 's1', 'orig'), caption('b', 's2', 'en')]);
    expect(captionGroups(plain, captionChips(plain, documents), documents).map((group) => group.label)).toEqual(['原文', 'English']);
  });

  it('点一组校对哪一段：留着之前选的；否则取盖住播放头最短的那段；拿下的不选', () => {
    const [, interviews, translations] = groups;
    expect(segmentAt(interviews!, seq, 130).documentId).toBe('i2');
    expect(segmentAt(interviews!, seq, 500).documentId).toBe('i1');
    expect(segmentAt(interviews!, seq, 130, interviews!.segments[0]!.key).documentId).toBe('i1');
    expect(segmentAt(interviews!, seq, 5000).documentId).toBe('i1');
    expect(segmentAt(translations!, seq, 130).documentId).toBe('t1');
  });

  it('段的来源名顺着派生找转写文档', () => {
    const named = { ...clips, sp: doc('sp', 'speech', '实拍 1'), tr1: doc('tr1', 'translation', '实拍 1 (zh-CN)', { sourceDocumentId: 'sp' }) };
    const t1 = chips.find((chip) => chip.documentId === 't1')!;
    expect(segmentSource(t1, named)).toBe('实拍 1');
    expect(segmentSource(t1, clips)).toBe('中文（中国）');
  });
});
