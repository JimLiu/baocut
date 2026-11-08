import { describe, expect, it } from 'vitest';
import { byteLength, decodeCursor, encodeCursor, pageDocument, pageEnd } from './document-pages.ts';

/** `documents_read` 的字节预算与分页（架构设计 §3.7）。纯函数，用合成的读取结果。 */

type Rec = Record<string, unknown>;

/** 一份有 `sentences` 句、每句 `perSentence` 个词的转写读取结果；句与句之间夹一个不在句子里的词。 */
function speechResult(sentences: number, perSentence: number): Rec {
  const words: Rec[] = [];
  const basis: Rec[] = [];
  for (let s = 0; s < sentences; s += 1) {
    const ids: string[] = [];
    for (let w = 0; w < perSentence; w += 1) {
      const id = `w${words.length}`;
      ids.push(id);
      words.push({ id, start: words.length * 100, end: words.length * 100 + 90, text: `word${s}-${w}` });
    }
    basis.push({
      id: `s${s}`,
      fingerprint: `fp${s}`,
      text: ids.map((_, w) => `word${s}-${w}`).join(' '),
      wordIds: ids,
      start: s,
      end: s + 0.9,
      alignment: null,
    });
    words.push({ id: `w${words.length}`, start: words.length * 100, end: words.length * 100 + 10, text: '' });
  }
  return {
    videoId: 'vid_1',
    document: { id: 'doc_speech', kind: 'speech', language: 'en' },
    revision: '7',
    body: { schema: 'baocut.speech/1', speakers: [{ id: 'spk_1', name: 'Speaker 1' }], words },
    translationBasis: { sourceBasis: { documentId: 'doc_speech', revision: '7' }, sentences: basis },
  };
}

function readAll(result: Rec, view: 'full' | 'sentences', budget: number): Rec[] {
  const pages: Rec[] = [];
  let from = 0;
  for (;;) {
    const page = pageDocument({ result, view, from, budget }) ?? result;
    expect(byteLength(page)).toBeLessThanOrEqual(budget);
    pages.push(page);
    if (typeof page.nextCursor !== 'string') return pages;
    from = decodeCursor(page.nextCursor)!.from;
    expect(pages.length).toBeLessThan(1000);
  }
}

describe('documents_read paging', () => {
  it('returns null when the whole result fits, so callers send it unchanged', () => {
    const result = speechResult(3, 4);
    expect(pageDocument({ result, view: 'full', from: 0, budget: 32 * 1024 })).toBeNull();
    expect(pageDocument({ result, view: 'full', from: 0, budget: null })).toBeNull();
  });

  it('pages a long transcript by sentence and every word lands on exactly one page', () => {
    const result = speechResult(400, 12);
    const all = (result.body as Rec).words as Rec[];
    const pages = readAll(result, 'full', 8 * 1024);
    expect(pages.length).toBeGreaterThan(5);
    const words = pages.flatMap((page) => (page.body as Rec).words as Rec[]);
    expect(words.map((w) => w.id)).toEqual(all.map((w) => w.id));
    const sentences = pages.flatMap((page) => (page.translationBasis as Rec).sentences as Rec[]);
    expect(sentences.map((s) => s.id)).toEqual(Array.from({ length: 400 }, (_, i) => `s${i}`));
    const first = pages[0]!;
    expect(first.coverage).toMatchObject({ unit: 'sentences', from: 0, total: 400, truncated: true });
    expect(first.next).toContain('view "sentences"');
    expect((first.body as Rec).speakers).toEqual([{ id: 'spk_1', name: 'Speaker 1' }]);
    const last = pages.at(-1)!;
    expect(last.nextCursor).toBeUndefined();
    expect((last.coverage as Rec).to).toBe(400);
  });

  it('lists only compact sentences in the sentences view, with speakers', () => {
    const result = speechResult(400, 12);
    const speakers = new Map([['s0', 'spk_1']]);
    const page = pageDocument({ result, view: 'sentences', from: 0, budget: null, speakers })!;
    expect(page.body).toBeUndefined();
    expect(page.speakers).toEqual([{ id: 'spk_1', name: 'Speaker 1' }]);
    expect(page.coverage).toMatchObject({ from: 0, to: 400, total: 400, truncated: false });
    expect(page.nextCursor).toBeUndefined();
    const sentences = (page.translationBasis as Rec).sentences as Rec[];
    expect(sentences[0]).toEqual({ id: 's0', fingerprint: 'fp0', text: sentences[0]!.text, speaker: 'spk_1', start: 0, end: 0.9 });
    expect(sentences[1]).not.toHaveProperty('speaker');
    expect(sentences[1]).not.toHaveProperty('wordIds');

    const pages = readAll(result, 'sentences', 8 * 1024);
    const fullPages = readAll(result, 'full', 8 * 1024);
    expect(pages.length).toBeLessThan(fullPages.length);
    expect(pages.flatMap((p) => (p.translationBasis as Rec).sentences as Rec[]).length).toBe(400);
    expect(pages[0]!.next).not.toContain('view "sentences" instead');
  });

  it('pages other documents by their largest body array', () => {
    const cues = Array.from({ length: 500 }, (_, i) => ({ id: `c${i}`, start: i, end: i + 1, text: `cue number ${i} with some words` }));
    const result = { videoId: 'vid_1', document: { id: 'doc_cap', kind: 'captions' }, revision: '3', body: { schema: 'x', style: {}, cues } };
    const pages = readAll(result, 'full', 4 * 1024);
    expect(pages[0]!.coverage).toMatchObject({ unit: 'body.cues', from: 0, total: 500, truncated: true });
    expect(pages.flatMap((p) => (p.body as Rec).cues as Rec[])).toEqual(cues);
    expect(pages.every((p) => (p.body as Rec).schema === 'x')).toBe(true);
  });

  it('always gives at least one item so a reader never stalls', () => {
    expect(pageEnd([100, 100], 0, 10)).toBe(1);
    expect(pageEnd([100, 100], 1, 10)).toBe(2);
    expect(pageEnd([10, 10, 10], 0, 22)).toBe(2);
  });

  it('round-trips cursors and rejects foreign ones', () => {
    const cursor = encodeCursor({ view: 'sentences', revision: '12', from: 180 });
    expect(cursor).toBe('s.12.180');
    expect(decodeCursor(cursor)).toEqual({ view: 'sentences', revision: '12', from: 180 });
    expect(decodeCursor('f.3.0')).toEqual({ view: 'full', revision: '3', from: 0 });
    expect(decodeCursor('x.3.0')).toBeNull();
    expect(decodeCursor('s.3')).toBeNull();
    expect(decodeCursor('s.3.-1')).toBeNull();
  });
});
