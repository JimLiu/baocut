import { describe, expect, it } from 'vitest';
import type { DocumentRecord, Id } from '@baocut/protocol';
import { syncSpeechCaptions } from './speech-captions.ts';

/**
 * 转写改字之后原文字幕跟着改（`syncSpeechCaptions`）：哪些操作算改字、加进去的字幕版本长什么样、来源版本什么时候跟着走。
 * 落到真实引擎里的一笔（撤销、回执）见 `caption-tools.test.ts`。
 */

const speechBody = {
  schema: 'baocut.speech/1',
  clock: 'source-asset',
  timescale: 1000,
  speakers: [],
  words: [
    { id: 'w1', start: 0, end: 500, text: 'Hello' },
    { id: 'w2', start: 500, end: 1000, text: 'there.' },
    { id: 'w3', start: 1600, end: 2000, text: 'Good' },
    { id: 'w4', start: 2000, end: 2500, text: 'morning.' },
  ],
  sentences: null,
};

const captionBody = {
  schema: 'baocut.caption/1',
  clock: 'source-asset',
  timescale: 1000,
  cues: [
    { id: 'q-w1', start: 0, end: 1000, text: 'Hello there.', words: { first: 'w1', last: 'w2' } },
    { id: 'q-w3', start: 1600, end: 2500, text: 'Good morning.', words: { first: 'w3', last: 'w4' } },
  ],
};

function record(id: Id, kind: string, revisions: string[], extra: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id,
    kind,
    name: kind,
    language: 'en',
    sourceAssetId: 'a1',
    sourceDocumentId: null,
    currentRevision: revisions.at(-1)!,
    revisions: Object.fromEntries(
      revisions.map((r) => [r, { revision: r, contentHash: `h${r}`, byteLength: 1, createdAt: '', createdBy: 'tx', summary: kind === 'caption' ? { cueCount: 2 } : null }]),
    ),
    extensions: {},
    ...extra,
  } as DocumentRecord;
}

function fixture() {
  const documents: Record<Id, DocumentRecord> = {
    s1: record('s1', 'speech', ['1', '2']),
    c1: record('c1', 'caption', ['1'], {
      sourceDocumentId: 's1',
      extensions: { 'baocut.speechCues': { speechDocumentId: 's1', speechRevision: '2', assetId: 'a1' } },
    }),
    other: record('other', 'caption', ['1'], { sourceDocumentId: 't1' }),
  };
  const bodies: Record<Id, unknown> = { s1: speechBody, c1: captionBody, other: captionBody };
  const reads: Id[] = [];
  const readBody = async (id: Id) => {
    reads.push(id);
    if (!(id in bodies)) throw new Error('missing');
    return structuredClone(bodies[id]);
  };
  return { documents, readBody, reads };
}

const texts = (op: Record<string, unknown> | undefined) => ((op?.body as typeof captionBody).cues ?? []).map((c) => c.text);

describe('syncSpeechCaptions', () => {
  it('updateWords：派生自这份转写的字幕加一个新版本（摘要照旧），来源版本改成转写的下一版；别的字幕不碰', async () => {
    const { documents, readBody, reads } = fixture();
    const operations: Record<string, unknown>[] = [{ type: 'updateWords', documentId: 's1', words: [{ id: 'w4', text: 'evening.' }] }];
    expect(await syncSpeechCaptions(operations, documents, readBody)).toEqual({ synced: 1, kept: [] });
    expect(operations).toHaveLength(2);
    expect(operations[1]).toMatchObject({
      type: 'putDocument',
      documentId: 'c1',
      kind: 'caption',
      summary: { cueCount: 2 },
      extensions: { 'baocut.speechCues': { speechDocumentId: 's1', speechRevision: '3', assetId: 'a1' } },
    });
    expect(texts(operations[1])).toEqual(['Hello there.', 'Good evening.']);
    expect(reads).not.toContain('other');
  });

  it('patchDocument 改 words 的 text 也算；只改隐藏、说话人的不跟', async () => {
    const { documents, readBody } = fixture();
    const patched: Record<string, unknown>[] = [
      { type: 'patchDocument', documentId: 's1', changes: [{ path: ['words', { id: 'w1' }, 'text'], value: 'Hi' }] },
    ];
    expect((await syncSpeechCaptions(patched, documents, readBody)).synced).toBe(1);
    expect(texts(patched[1])).toEqual(['Hi there.', 'Good morning.']);

    const hidden: Record<string, unknown>[] = [
      { type: 'patchDocument', documentId: 's1', changes: [{ path: ['words', { id: 'w1' }, 'hidden'], value: true }] },
      { type: 'renameSpeakers', documentId: 's1', speakers: [{ id: 'spk-1', name: 'Ann' }] },
    ];
    expect(await syncSpeechCaptions(hidden, documents, readBody)).toEqual({ synced: 0, kept: [] });
    expect(hidden).toHaveLength(2);
  });

  it('同一笔写了这份转写几次：照样跟着改字，但推不准下一个版本号，来源版本不动', async () => {
    const { documents, readBody } = fixture();
    const operations: Record<string, unknown>[] = [
      { type: 'updateWords', documentId: 's1', words: [{ id: 'w1', text: 'Hi' }] },
      { type: 'updateWords', documentId: 's1', words: [{ id: 'w2', text: 'there!' }] },
    ];
    expect((await syncSpeechCaptions(operations, documents, readBody)).synced).toBe(1);
    expect(texts(operations[2])).toEqual(['Hi there!', 'Good morning.']);
    expect(operations[2]!.extensions).toBeUndefined();
  });

  it('字幕本来就落后于转写（来源版本不是当前版）时只改字，不把它标成跟上了', async () => {
    const { documents, readBody } = fixture();
    documents.c1 = { ...documents.c1!, extensions: { 'baocut.speechCues': { speechDocumentId: 's1', speechRevision: '1' } } };
    const operations: Record<string, unknown>[] = [{ type: 'updateWords', documentId: 's1', words: [{ id: 'w1', text: 'Hi' }] }];
    expect((await syncSpeechCaptions(operations, documents, readBody)).synced).toBe(1);
    expect(operations[1]!.extensions).toBeUndefined();
  });

  it('手改过的句子报在 kept，来源版本不动；这一笔自己写了的字幕文档不碰', async () => {
    const { documents, readBody } = fixture();
    const edited = structuredClone(captionBody);
    edited.cues[1]!.text = 'Good morning, all!';
    const read = async (id: Id) => (id === 'c1' ? structuredClone(edited) : readBody(id));
    const operations: Record<string, unknown>[] = [
      { type: 'updateWords', documentId: 's1', words: [{ id: 'w1', text: 'Hi' }, { id: 'w4', text: 'evening.' }] },
    ];
    expect(await syncSpeechCaptions(operations, documents, read)).toEqual({ synced: 1, kept: [{ documentId: 'c1', cueIds: ['q-w3'] }] });
    expect(texts(operations[1])).toEqual(['Hi there.', 'Good morning, all!']);
    expect(operations[1]!.extensions).toBeUndefined();

    const own: Record<string, unknown>[] = [
      { type: 'updateWords', documentId: 's1', words: [{ id: 'w1', text: 'Hi' }] },
      { type: 'patchDocument', documentId: 'c1', changes: [{ path: ['cues', { id: 'q-w1' }, 'text'], value: 'Hi there' }] },
    ];
    expect(await syncSpeechCaptions(own, documents, readBody)).toEqual({ synced: 0, kept: [] });
  });

  it('整份替换转写（putDocument 给 documentId）按新正文改字；转写读不了时不跟', async () => {
    const { documents, readBody } = fixture();
    const replaced = structuredClone(speechBody);
    replaced.words[2]!.text = 'Bad';
    const operations: Record<string, unknown>[] = [{ type: 'putDocument', documentId: 's1', kind: 'speech', body: replaced }];
    expect((await syncSpeechCaptions(operations, documents, readBody)).synced).toBe(1);
    expect(texts(operations[1])).toEqual(['Hello there.', 'Bad morning.']);

    const broken: Record<string, unknown>[] = [{ type: 'updateWords', documentId: 's1', words: [{ id: 'w1', text: 'Hi' }] }];
    const unreadable = async (id: Id) => (id === 's1' ? Promise.reject(new Error('gone')) : readBody(id));
    expect(await syncSpeechCaptions(broken, documents, unreadable)).toEqual({ synced: 0, kept: [] });
  });
});
