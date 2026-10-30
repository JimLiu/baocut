import { describe, expect, it } from 'vitest';
import type { ImportableSession } from '@baocut/protocol';
import { IMPORT_COPY as I } from '../components/agent-import/import-copy.ts';
import { filterImportable, importMeta, sourceName, sourceWhere, titleInSentence } from './agent-import.ts';

/** 导入外部会话的对话框（产品设计 §3.1「导入外部会话」）：列表的筛选、每行下面那一行、Agent 的名字与出处。 */

const NOW = Date.parse('2026-10-30T12:00:00.000Z');
const session = (patch: Partial<ImportableSession>): ImportableSession => ({
  driverId: 'claude',
  nativeId: 'n1',
  cwd: '/Users/me/work/promo',
  title: 'Cut the intro.',
  turns: 3,
  updatedAt: '2026-10-30T11:30:00.000Z',
  landing: { kind: 'adopt', name: 'promo' },
  importedAs: null,
  ...patch,
});

describe('filterImportable', () => {
  const list = [
    session({ nativeId: 'a', updatedAt: '2026-10-30T09:00:00.000Z' }),
    session({ nativeId: 'b', driverId: 'codex', title: 'Make a trailer', cwd: '/work/Trailer' }),
    session({ nativeId: 'c', title: 'Captions', cwd: null, updatedAt: '2026-10-30T11:59:00.000Z' }),
  ];

  it('只列选中的那一家，最近的在前', () => {
    expect(filterImportable(list, { driverId: 'claude', query: '' }).map((s) => s.nativeId)).toEqual(['c', 'a']);
    expect(filterImportable(list, { driverId: null, query: '' }).map((s) => s.nativeId)).toEqual(['c', 'b', 'a']);
  });

  it('搜第一句与目录，不分大小写；没有目录的只按第一句', () => {
    expect(filterImportable(list, { driverId: null, query: ' trailer ' }).map((s) => s.nativeId)).toEqual(['b']);
    expect(filterImportable(list, { driverId: null, query: 'PROMO' }).map((s) => s.nativeId)).toEqual(['a']);
    expect(filterImportable(list, { driverId: null, query: 'capt' }).map((s) => s.nativeId)).toEqual(['c']);
  });
});

describe('importMeta', () => {
  it('目录（家目录缩成 ~）· 多久前 · 几轮；不知道几轮不写；没有目录与导入过的写明', () => {
    expect(importMeta(session({}), NOW)).toBe(`~/work/promo · 30 分钟前 · ${I.turns(3)}`);
    expect(importMeta(session({ turns: null, cwd: null, importedAs: 'conv_1' }), NOW)).toBe(`${I.noFolder} · 30 分钟前 · ${I.imported}`);
  });
});

describe('sourceName / sourceWhere', () => {
  it('探测结果里的名字优先，没有时用内置的；出处按 Agent', () => {
    expect(sourceName('claude')).toBe('Claude Code');
    expect(sourceName('codex', null)).toBe('Codex');
    expect(sourceName('claude', 'Claude Code (beta)')).toBe('Claude Code (beta)');
    expect(sourceWhere('claude')).toBe('~/.claude/projects');
    expect(sourceWhere('codex')).toBe(I.whereCodex);
  });
});

describe('titleInSentence', () => {
  it('去掉末尾的句末标点，句子里只留一个句号；别处的标点不动', () => {
    expect(titleInSentence('Cut the intro, then add captions.')).toBe('Cut the intro, then add captions');
    expect(titleInSentence('剪掉片头。')).toBe('剪掉片头');
    expect(titleInSentence('Why so slow?! ')).toBe('Why so slow');
    expect(titleInSentence('v1.2 notes')).toBe('v1.2 notes');
    expect(titleInSentence('...')).toBe('');
  });
});
