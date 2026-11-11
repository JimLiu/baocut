import { describe, expect, it } from 'vitest';
import type { DocumentRecord } from '@baocut/protocol';
import { editorWasmAvailable, sourceSentences } from '@baocut/jobs';
import { translationCoverage, writtenTranslations } from './translation-coverage.ts';

/** 写进视频的译文覆盖了转写的多少句（分批写长译文时进度记录与「没做完」据此判断）。句子经 editor-wasm 派生，没有构建时跳过那一组。 */

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
    { id: 'w5', start: 3000, end: 3400, text: 'Bye.' },
  ],
};

describe('一笔修改写到的译文', () => {
  const documents: Record<string, DocumentRecord> = {
    speech: { id: 'speech', kind: 'speech', name: '转写', currentRevision: '3', revisions: {} },
    trans: { id: 'trans', kind: 'translation', name: '译文', currentRevision: '1', revisions: {}, sourceDocumentId: 'speech' },
  };

  it('整份写入（新建的按 ref 取 ID）与给已有译文的补丁；别的文档的补丁不算，同一份只报一次', () => {
    const operations = [
      { type: 'putDocument', kind: 'translation', ref: 'new', language: 'ja', sourceDocument: { documentId: 'speech' }, body: {} },
      { type: 'patchDocument', documentId: 'trans', changes: [] },
      { type: 'patchDocument', documentId: 'trans', changes: [] },
      { type: 'patchDocument', documentId: 'speech', changes: [] },
      { type: 'putDocument', kind: 'speech', documentId: 'speech', body: {} },
    ];
    expect(writtenTranslations(operations, documents, { new: 'doc_ja' })).toEqual([
      { documentId: 'doc_ja', put: true, sourceDocumentId: 'speech', language: 'ja' },
      { documentId: 'trans', put: false, sourceDocumentId: null, language: null },
    ]);
  });
});

describe.skipIf(!editorWasmAvailable())('译文覆盖了转写的多少句', () => {
  const read = sourceSentences(speechBody);
  if ('problem' in read) throw new Error(read.problem);
  const sentences = read.sentences;
  const unit = (index: number, text: string, extra: Record<string, unknown> = {}) => ({
    id: `t-${sentences[index]!.id}`,
    sourceSentenceId: sentences[index]!.id,
    sourceFingerprint: sentences[index]!.fingerprint,
    naturalText: text,
    alignment: null,
    status: 'draft',
    ...extra,
  });
  const body = (units: unknown[]) => ({ schema: 'baocut.translation/2', language: 'zh-Hans', sourceBasis: {}, units });

  it('按转写的句序数：译好的句数、总句数、第一句还没译好的', () => {
    expect(sentences).toHaveLength(3);
    expect(translationCoverage(body([unit(0, '你好。')]), speechBody)).toEqual({ covered: 1, total: 3, nextSentenceId: sentences[1]!.id });
    expect(translationCoverage(body([unit(0, '你好。'), unit(1, '早上好。'), unit(2, '再见。')]), speechBody)).toEqual({
      covered: 3,
      total: 3,
      nextSentenceId: null,
    });
  });

  it('过期、指纹对不上、译文为空的不算译好', () => {
    const units = [unit(0, '你好。', { status: 'stale' }), unit(1, '早上好。', { sourceFingerprint: 'other' }), unit(2, '  ')];
    expect(translationCoverage(body(units), speechBody)).toEqual({ covered: 0, total: 3, nextSentenceId: sentences[0]!.id });
  });

  it('读不出时为 null：不是 baocut.translation/2，或转写不对', () => {
    expect(translationCoverage({ schema: 'other', units: [] }, speechBody)).toBeNull();
    expect(translationCoverage(body([unit(0, '你好。')]), { schema: 'baocut.speech/1' })).toBeNull();
  });
});
