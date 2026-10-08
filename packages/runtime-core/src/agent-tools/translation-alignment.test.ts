import { describe, expect, it } from 'vitest';
import type { DocumentRecord } from '@baocut/protocol';
import { editorWasmAvailable, sha256Hex, sourceSentences } from '@baocut/jobs';
import { fillTranslationAlignments } from './translation-alignment.ts';

/** 智能体写译文时 Runtime 按句子补上的句级对齐（视频格式规范 §5.3）。句子经 editor-wasm 派生，没有构建时跳过。 */

const speechBody = {
  schema: 'baocut.speech/1',
  clock: 'source-asset',
  timescale: 1000,
  speakers: [],
  sentences: null,
  chapters: [],
  words: [
    { id: 'w1', start: 0, end: 400, text: 'Hello' },
    { id: 'w2', start: 400, end: 900, text: 'there.' },
    { id: 'w3', start: 1500, end: 1900, text: 'Good' },
    { id: 'w4', start: 1900, end: 2400, text: 'morning.' },
  ],
};

describe.skipIf(!editorWasmAvailable())('putDocument 译文：补句级对齐', () => {
  const read = sourceSentences(speechBody);
  if ('problem' in read) throw new Error(read.problem);
  const [first, second] = read.sentences;
  const hash = (text: string) => `sha256:${sha256Hex(text)}`;
  const documents: Record<string, DocumentRecord> = {
    speech: { id: 'speech', kind: 'speech', name: '转写', currentRevision: '3', revisions: {} },
    trans: { id: 'trans', kind: 'translation', name: '译文', currentRevision: '1', revisions: {}, sourceDocumentId: 'speech' },
  };
  const reads: Array<[string, string | undefined]> = [];
  const readSpeech = async (documentId: string, revision?: string) => {
    reads.push([documentId, revision]);
    if (documentId !== 'speech') throw new Error('没有这份文档');
    return speechBody;
  };
  const unit = (sentence: { id: string; fingerprint: string }, text: string, extra: Record<string, unknown> = {}) => ({
    id: `t-${sentence.id}`,
    sourceSentenceId: sentence.id,
    sourceFingerprint: sentence.fingerprint,
    naturalText: text,
    alignment: null,
    status: 'draft',
    ...extra,
  });
  const put = (units: unknown[], extra: Record<string, unknown> = {}) => ({
    type: 'putDocument',
    kind: 'translation',
    language: 'zh-Hans',
    sourceDocument: { documentId: 'speech' },
    body: {
      schema: 'baocut.translation/2',
      language: 'zh-Hans',
      sourceBasis: { speechRef: { id: 'speech', revision: '3' }, sequenceId: 'seq', scopeLineage: [], editViewHash: read.editViewHash },
      units,
    },
    ...extra,
  });

  it('alignment 为 null：按句子补成句级对齐，textHash 按译文算；调用方的正文不改', async () => {
    const op = put([unit(first!, '你好。'), unit(second!, '早上好。')]);
    const original = op.body;
    const operations: Record<string, unknown>[] = [op];
    expect(await fillTranslationAlignments(operations, documents, readSpeech)).toBe(2);
    const units = (operations[0]!.body as { units: Array<{ alignment: unknown }> }).units;
    expect(units.map((u) => u.alignment)).toEqual([
      { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: ['w1', 'w2'], textHash: hash('你好。') },
      { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: ['w3', 'w4'], textHash: hash('早上好。') },
    ]);
    expect(original.units.every((u) => (u as { alignment: unknown }).alignment === null)).toBe(true);
    expect(reads.at(-1)).toEqual(['speech', '3']);
  });

  it('写了句级对齐：补上 textHash，译文改过时重算；块级的对齐不动', async () => {
    const sentence = { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: ['w1', 'w2'] };
    const blocks = {
      basis: 'natural',
      correspondence: 'block',
      blocks: [{ id: 'b1' }],
      sourceWordIds: ['w3', 'w4'],
      textHash: 'sha256:old',
    };
    const operations: Record<string, unknown>[] = [
      put([
        unit(first!, '你好。', { alignment: { ...sentence, textHash: 'sha256:old' } }),
        unit(second!, '早上好。', { alignment: blocks }),
      ]),
      put([unit(first!, '嗨。', { alignment: sentence })]),
    ];
    expect(await fillTranslationAlignments(operations, documents, readSpeech)).toBe(2);
    const alignments = operations.map((op) => (op.body as { units: Array<{ alignment: unknown }> }).units.map((u) => u.alignment));
    expect(alignments).toEqual([[{ ...sentence, textHash: hash('你好。') }, blocks], [{ ...sentence, textHash: hash('嗨。') }]]);
  });

  it('核对不上的不补：指纹不同、句子不在、过期的单元；转写读不到时整份不动', async () => {
    const op = put([
      unit(first!, '你好。', { sourceFingerprint: 'other' }),
      unit({ id: 's-gone', fingerprint: '' }, '没了。'),
      unit(second!, '早上好。', { status: 'stale' }),
    ]);
    expect(await fillTranslationAlignments([op], documents, readSpeech)).toBe(0);
    const missing = put([unit(first!, '你好。')], { sourceDocument: { documentId: 'nope' } });
    (missing.body.sourceBasis as { speechRef: { id: string } }).speechRef.id = 'nope';
    expect(await fillTranslationAlignments([missing], documents, readSpeech)).toBe(0);
    expect((missing.body.units[0] as { alignment: unknown }).alignment).toBeNull();
    // 读不到句子时，写了对齐对象却没写 textHash 的照样补上（它只看译文）。
    const sentence = { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: ['w1', 'w2'] };
    const hashOnly = put([unit(first!, '你好。', { alignment: sentence })], { sourceDocument: { documentId: 'nope' } });
    (hashOnly.body.sourceBasis as { speechRef: { id: string } }).speechRef.id = 'nope';
    expect(await fillTranslationAlignments([hashOnly], documents, readSpeech)).toBe(1);
    expect((hashOnly.body.units[0] as { alignment: unknown }).alignment).toEqual({ ...sentence, textHash: hash('你好。') });
  });

  it('改已有的译文（只给 documentId）：转写从文档头的来源找；记下的版本读不到时读当前版本', async () => {
    const op: Record<string, unknown> = { ...put([unit(first!, '你好。')]), documentId: 'trans' };
    delete op.sourceDocument;
    const body = op.body as { sourceBasis: Record<string, unknown> };
    body.sourceBasis = { ...body.sourceBasis, speechRef: { revision: '2' } };
    let first_ = true;
    const flaky = async (documentId: string, revision?: string) => {
      if (first_ && revision === '2') {
        first_ = false;
        throw new Error('没有这一版');
      }
      return readSpeech(documentId, revision);
    };
    expect(await fillTranslationAlignments([op], documents, flaky)).toBe(1);
    expect(reads.at(-1)).toEqual(['speech', undefined]);
  });
});
