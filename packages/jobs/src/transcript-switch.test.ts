import { describe, expect, it } from 'vitest';
import type { DocumentRecord, EditOperation, Id, TranscriptReplace } from '@baocut/protocol';
import { ApplyRejected, StaleInput } from './job-application.ts';
import { SPEECH_CAPTION_EXTENSION } from './pipelines/caption-layer.ts';
import { DUB_EXTENSION } from './pipelines/dub.ts';
import {
  TRANSCRIPT_SWITCH_EXTENSION,
  contentFingerprint,
  normalizeText,
  pairSentences,
  planTranscriptSwitch,
  type SwitchVideos,
} from './transcript-switch.ts';

/**
 * 换用文稿（架构设计 §6.6）：一笔事务写已有文稿的新版本，结转译文（视频格式规范 §5.3）、字幕、换行与分段（§5.5）
 * 与配音计划（§7.2）。真实引擎上的整条路径见 runtime-core 的 `transcribe-pipeline.test.ts`。
 */

type PutDocument = Extract<EditOperation, { type: 'putDocument' }>;

const speech = (words: Array<[string, number, number, string]>, extra: Record<string, unknown> = {}) => ({
  schema: 'baocut.speech/1',
  timescale: 1000,
  words: words.map(([id, start, end, text]) => ({ id, start, end, text, speaker: 'a' })),
  ...extra,
});

const record = (id: Id, kind: string, extra: Partial<DocumentRecord> & Record<string, unknown> = {}): DocumentRecord =>
  ({
    id,
    kind,
    name: id,
    currentRevision: '1',
    revisions: { '1': { revision: '1', summary: kind === 'translation' ? { unitCount: 2 } : {} } },
    extensions: {},
    ...extra,
  }) as unknown as DocumentRecord;

/** 旧文稿两句；第二句的「line.」上有一个用户换行，第一句末尾一个，第二句开头一个分段。 */
const previousSpeech = speech(
  [
    ['w0', 0, 400, 'Hello'],
    ['w1', 500, 900, ' there.'],
    ['w2', 2000, 2400, ' Second'],
    ['w3', 2500, 2900, ' line.'],
  ],
  { userBreaks: { w1: 'break', w3: 'no-break' }, paragraphBreaks: ['w2'], layoutProfileId: 'layout-1' },
);

/** 新转写：第一句原文一样（大小写与标点不同也算一样），第二句改了。词 ID 全是新的。 */
const nextSpeech = speech([
  ['w-2-000000', 10, 410, 'hello'],
  ['w-2-000001', 510, 910, ' there!'],
  ['w-2-000002', 2010, 2410, ' Second'],
  ['w-2-000003', 2510, 2910, ' take.'],
]);

const translation = {
  schema: 'baocut.translation/2',
  language: 'zh-Hans',
  sourceBasis: { speechRef: { id: 'doc_speech', revision: '1' }, sequenceId: 'seq', scopeLineage: [], editViewHash: 'sha256:old' },
  units: [
    {
      id: 't-s-w0',
      sourceSentenceId: 's-w0',
      sourceFingerprint: 'old',
      naturalText: '你好。',
      displayRewrite: { text: '你好', reason: 'length', reviewed: true },
      alignment: { basis: 'display-rewrite', correspondence: 'block', blocks: [{}], sourceWordIds: ['w0', 'w1'], textHash: 'x' },
      status: 'reviewed',
    },
    {
      id: 't-s-w2',
      sourceSentenceId: 's-w2',
      sourceFingerprint: 'old',
      naturalText: '第二行。',
      alignment: null,
      status: 'draft',
    },
  ],
};

const dubPlan = {
  language: 'zh-Hans',
  translationRef: { id: 'doc_tr', revision: '1' },
  units: [
    {
      id: 'd-t-s-w0',
      status: 'ready',
      script: '你好',
      actualSamples: 100,
      sampleRate: 48000,
      targetAnchor: { kind: 'sentence', edge: 'start', sentenceId: 's-w0' },
      extensions: { [DUB_EXTENSION]: { translationUnitId: 't-s-w0' } },
    },
    {
      id: 'd-t-s-w2',
      status: 'ready',
      script: '第二行',
      actualSamples: 5,
      sampleRate: 48000,
      extensions: { [DUB_EXTENSION]: { translationUnitId: 't-s-w2' } },
    },
  ],
};

function fakeVideos(previous: unknown = previousSpeech): SwitchVideos {
  const bodies: Record<Id, unknown> = {
    doc_speech: previous,
    doc_tr: translation,
    doc_cap: { schema: 'baocut.caption/1', style: { size: 42 }, cues: [] },
    doc_cap_other: { schema: 'baocut.caption/1', cues: [] },
    doc_dub: dubPlan,
  };
  const documents: Record<Id, DocumentRecord> = {
    doc_speech: record('doc_speech', 'speech', { sourceAssetId: 'asset_a' }),
    doc_tr: record('doc_tr', 'translation', { sourceDocumentId: 'doc_speech', language: 'zh-Hans' }),
    doc_cap: record('doc_cap', 'caption', {
      sourceDocumentId: 'doc_speech',
      extensions: { [SPEECH_CAPTION_EXTENSION]: { speechRevision: '1', derivation: 'x' } },
    }),
    doc_cap_other: record('doc_cap_other', 'caption', { sourceDocumentId: 'doc_elsewhere' }),
    doc_dub: record('doc_dub', 'dubbing-plan', { sourceDocumentId: 'doc_tr' }),
  };
  return {
    state: () => ({ revision: '7', documents }),
    document: async (_videoId, documentId) => ({ revision: '1', body: structuredClone(bodies[documentId]) }),
  };
}

const replaceOf = (translations: TranscriptReplace['translations'] = 'carry'): TranscriptReplace => ({
  documentId: 'doc_speech',
  revision: '1',
  fingerprint: contentFingerprint(previousSpeech),
  translations,
});

const newSpeechOp = (): PutDocument =>
  ({ type: 'putDocument', kind: 'speech', name: '转写', body: structuredClone(nextSpeech) }) as PutDocument;

describe('换用文稿', () => {
  it('规范化文本：去掉标点与空白，NFKC，大小写折叠', () => {
    expect(normalizeText('Hello, World!')).toBe(normalizeText(' hello world'));
    expect(normalizeText('ＡＢＣ　１２')).toBe('abc12');
    expect(normalizeText('你好，世界。')).toBe('你好世界');
    expect(normalizeText('Straße')).not.toBe(normalizeText('Strasse!x'));
  });

  it('句子配对：按素材时钟的重叠贪心配对，重叠不到较短一句的一半不配；两边的刻度各算各的', () => {
    const prev = [
      { start: 0, end: 1000 },
      { start: 1000, end: 2000 },
      { start: 2000, end: 2200 },
    ];
    // 新的刻度是 10_000：第一句 0–1.1s，第二句 1.1–2.0s，第三句 2.15–3s（与旧第三句重叠 0.05s，不到 0.1s 的一半）。
    const next = [
      { start: 0, end: 11_000 },
      { start: 11_000, end: 20_000 },
      { start: 21_500, end: 30_000 },
    ];
    expect([...pairSentences(prev, 1000, next, 10_000)].sort()).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('一笔事务：文稿的新版本在前；译文、字幕、配音计划结转，换行与分段按时间重锚，影响记在文稿扩展里', async () => {
    const { operations, impact } = await planTranscriptSwitch(fakeVideos(), {
      videoId: 'vid_1',
      replace: replaceOf(),
      speech: newSpeechOp(),
      jobId: 'job_1',
    });
    expect(operations.map((op) => (op as PutDocument).documentId)).toEqual(['doc_speech', 'doc_tr', 'doc_cap', 'doc_dub']);

    const head = operations[0] as PutDocument & { name?: string };
    expect(head.name).toBeUndefined();
    const body = head.body as Record<string, unknown>;
    expect(body.userBreaks).toEqual({ 'w-2-000001': 'break', w3: 'no-break' });
    expect(body.paragraphBreaks).toEqual(['w-2-000002']);
    expect(body.layoutProfileId).toBe('layout-1');
    expect((body.stages as { asr: string }).asr).toBe(contentFingerprint(body));
    expect(head.extensions?.[TRANSCRIPT_SWITCH_EXTENSION]).toEqual({ jobId: 'job_1', previousRevision: '1', revision: '2', impact });

    expect(impact).toEqual({
      translations: [{ language: 'zh-Hans', documentId: 'doc_tr', kept: 1, keptReviewed: 1, stale: 1, unmatched: 0 }],
      captionPins: { reanchored: 2, orphaned: 1 },
      dubs: [{ language: 'zh-Hans', documentId: 'doc_dub', kept: 1, stale: 1 }],
    });

    const tr = operations[1] as PutDocument;
    const trBody = tr.body as typeof translation;
    expect(trBody.sourceBasis.speechRef).toEqual({ id: 'doc_speech', revision: '2' });
    expect(trBody.sourceBasis.editViewHash).not.toBe('sha256:old');
    expect(trBody.units[0]).toMatchObject({
      id: 't-s-w-2-000000',
      sourceSentenceId: 's-w-2-000000',
      naturalText: '你好。',
      displayRewrite: { text: '你好' },
      status: 'reviewed',
      alignment: { basis: 'display-rewrite', correspondence: 'sentence', blocks: [], sourceWordIds: ['w-2-000000', 'w-2-000001'] },
    });
    expect(trBody.units[1]).toMatchObject({
      id: 't-s-w-2-000002',
      naturalText: '第二行。',
      status: 'stale',
      alignment: { basis: 'natural' },
    });
    expect(trBody.units[1]).not.toHaveProperty('displayRewrite');
    expect(tr.summary).toEqual({ unitCount: 2 });

    const cap = operations[2] as PutDocument;
    expect(cap.body).toMatchObject({ style: { size: 42 } });
    expect((cap.body as { cues: unknown[] }).cues.length).toBeGreaterThan(0);
    expect(cap.extensions).toEqual({ [SPEECH_CAPTION_EXTENSION]: { speechRevision: '2', derivation: 'x' } });

    const dub = (operations[3] as PutDocument).body as typeof dubPlan;
    expect(dub.translationRef).toEqual({ id: 'doc_tr', revision: '2' });
    expect(dub.units[0]).toMatchObject({
      id: 'd-t-s-w-2-000000',
      status: 'ready',
      script: '你好',
      actualSamples: 100,
      targetAnchor: { sentenceId: 's-w-2-000000', speechRef: { id: 'doc_speech', revision: '2' } },
      extensions: { [DUB_EXTENSION]: { translationUnitId: 't-s-w-2-000000' } },
    });
    expect(dub.units[1]).toMatchObject({
      status: 'stale',
      script: null,
      extensions: { [DUB_EXTENSION]: { staleReason: 'source-changed' } },
    });
    expect(dub.units[1]).not.toHaveProperty('actualSamples');
  });

  it('translations: discard：译文与随它的配音计划不动，只换文稿、重切派生自文稿的字幕', async () => {
    const { operations, impact } = await planTranscriptSwitch(fakeVideos(), {
      videoId: 'vid_1',
      replace: replaceOf('discard'),
      speech: newSpeechOp(),
      jobId: 'job_1',
    });
    expect(operations.map((op) => (op as PutDocument).documentId)).toEqual(['doc_speech', 'doc_cap']);
    expect(impact).toMatchObject({ translations: [], dubs: [] });
  });

  it('应用前文稿又被改过：以 TRANSCRIPT_EDITED 拒绝；文稿不在时是过期的输入', async () => {
    const edited = speech([
      ['w0', 0, 400, 'Hello'],
      ['w1', 500, 900, ' friend.'],
    ]);
    const rejected = await planTranscriptSwitch(fakeVideos(edited), {
      videoId: 'vid_1',
      replace: replaceOf(),
      speech: newSpeechOp(),
      jobId: 'job_1',
    }).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(ApplyRejected);
    expect(rejected).toMatchObject({ code: 'TRANSCRIPT_EDITED', details: { documentId: 'doc_speech' } });

    const gone = await planTranscriptSwitch(
      { ...fakeVideos(), state: () => ({ revision: '7', documents: {} }) },
      { videoId: 'vid_1', replace: replaceOf(), speech: newSpeechOp(), jobId: 'job_1' },
    ).catch((error: unknown) => error);
    expect(gone).toBeInstanceOf(StaleInput);
  });
});
