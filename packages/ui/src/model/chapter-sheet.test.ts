import { describe, expect, it } from 'vitest';
import type { DocumentRecord } from '@baocut/protocol';
import { chapterScripts, chapterSheetRecord } from './chapter-sheet.ts';

const record = (id: string, kind: string, createdAt: string): DocumentRecord => ({
  id,
  kind,
  name: id,
  currentRevision: 'r1',
  revisions: { r1: { revision: 'r1', fingerprint: 'f', createdAt, createdBy: 't' } as never },
});

const sheet = (overrides: Record<string, unknown> = {}) => ({
  schema: 'baocut.chapter-sheet/1',
  sequenceId: 'seq_main',
  kind: 'explainer',
  chapters: [
    { id: 's01', title: '开场', script: { markdown: '# 开场\n\n第一段旁白' }, status: 'placed' },
    { id: 's02', title: '没编译', script: { markdown: '还没放上时间线' }, status: 'built' },
    { id: 's03', title: '空脚本', script: { markdown: '  ' }, status: 'placed' },
    { id: 's04', title: '没有脚本', status: 'placed' },
  ],
  compiled: {
    s01: { itemId: 'item_1', markerId: 'mk_1', audioItemIds: [], viaTransactionId: 'tx' },
    s03: { itemId: 'item_3', markerId: 'mk_3', audioItemIds: [], viaTransactionId: 'tx' },
    s04: { itemId: 'item_4', markerId: 'mk_4', audioItemIds: [], viaTransactionId: 'tx' },
  },
  ...overrides,
});

describe('章节表的脚本', () => {
  it('按 compiled 的标记 ID 取每章的脚本；没编译、空白或没有脚本的章节不出现', () => {
    expect([...chapterScripts(sheet(), 'seq_main')]).toEqual([['mk_1', '# 开场\n\n第一段旁白']]);
  });

  it('别的序列、别的 schema 或形状不对的正文都是空表', () => {
    expect(chapterScripts(sheet(), 'seq_other').size).toBe(0);
    expect(chapterScripts(sheet({ schema: 'baocut.chapter-sheet/2' }), 'seq_main').size).toBe(0);
    expect(chapterScripts(sheet({ chapters: 'oops', compiled: null }), 'seq_main').size).toBe(0);
    expect(chapterScripts(null, 'seq_main').size).toBe(0);
  });

  it('取最新写入的一份章节表，别的种类不算', () => {
    const documents = {
      a: record('a', 'chapter-sheet', '2026-10-20T01:00:00Z'),
      b: record('b', 'chapter-sheet', '2026-10-20T02:00:00Z'),
      c: record('c', 'speech', '2026-10-20T03:00:00Z'),
    };
    expect(chapterSheetRecord(documents)?.id).toBe('b');
    expect(chapterSheetRecord({ c: documents.c })).toBeNull();
  });
});
