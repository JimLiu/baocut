import { describe, expect, it } from 'vitest';
import type { DocumentRecord } from '@baocut/protocol';
import {
  changeCount,
  changedSections,
  readScript,
  restoreSummary,
  scriptBlocks,
  scriptDiff,
  scriptRecord,
  scriptVersions,
  sectionFor,
  versionChange,
} from './script-document.ts';

const v1 = '# 片名\n\n## s01 钩子\n\n第一段旁白。\n\n## s02 写作文\n\n第二段旁白。';
const v2 = '# 片名\n\n## s01 钩子\n\n第一段旁白，改过。\n\n## s02 写作文\n\n第二段旁白。\n\n## s03 涂卡\n\n第三段。';

const revision = (id: string, createdAt: string, summary?: unknown) => ({
  revision: id,
  contentHash: 'h',
  byteLength: 1,
  createdAt,
  createdBy: `tx_${id}`,
  summary,
});
const record = (id: string, kind: string, revisions: ReturnType<typeof revision>[]): DocumentRecord => ({
  id,
  kind,
  name: id,
  currentRevision: revisions[revisions.length - 1]!.revision,
  revisions: Object.fromEntries(revisions.map((r) => [r.revision, r])),
});

describe('脚本文档', () => {
  it('取当前版本最新写入的一份脚本，别的种类不算', () => {
    const documents = {
      a: record('a', 'script', [revision('r1', '2026-10-21T01:00:00Z')]),
      b: record('b', 'script', [revision('r1', '2026-10-21T02:00:00Z')]),
      c: record('c', 'chapter-sheet', [revision('r1', '2026-10-21T03:00:00Z')]),
    };
    expect(scriptRecord(documents)?.id).toBe('b');
    expect(scriptRecord({ c: documents.c })).toBeNull();
  });

  it('只认 baocut.script/1 且 markdown 是字符串的正文；空白文件名不算', () => {
    expect(readScript({ schema: 'baocut.script/1', markdown: v1, file: '脚本.md' })).toEqual({ markdown: v1, file: '脚本.md' });
    expect(readScript({ schema: 'baocut.script/1', markdown: v1, file: ' ' })).toEqual({ markdown: v1, file: null });
    expect(readScript({ schema: 'baocut.script/2', markdown: v1 })).toBeNull();
    expect(readScript({ schema: 'baocut.script/1', markdown: 3 })).toBeNull();
    expect(readScript(null)).toBeNull();
  });

  it('版本按写入先后从 1 数；回到版本写出来的一版记着从哪一版回来', () => {
    const doc = record('s', 'script', [
      revision('r3', '2026-10-21T03:00:00Z', restoreSummary('r1')),
      revision('r1', '2026-10-21T01:00:00Z'),
      revision('r2', '2026-10-21T02:00:00Z', { words: 10 }),
    ]);
    expect(scriptVersions(doc).map((v) => [v.n, v.revision, v.restoredFrom, v.createdBy])).toEqual([
      [1, 'r1', null, 'tx_r1'],
      [2, 'r2', null, 'tx_r2'],
      [3, 'r3', 'r1', 'tx_r3'],
    ]);
  });

  it('每一版相对前一版：第一版是写入，回到版本记着第几版，正文没取到时不比', () => {
    const doc = record('s', 'script', [
      revision('r1', '2026-10-21T01:00:00Z'),
      revision('r2', '2026-10-21T02:00:00Z'),
      revision('r3', '2026-10-21T03:00:00Z', restoreSummary('r1')),
    ]);
    const versions = scriptVersions(doc);
    const bodies: Record<string, string> = { r1: v1, r2: v2, r3: v1 };
    const of = (r: string) => bodies[r] ?? null;
    expect(versionChange(versions, 0, of)).toEqual({ kind: 'create', from: null, changes: null });
    const edit = versionChange(versions, 1, of);
    expect([edit.kind, changeCount(edit.changes!)]).toEqual(['edit', 3]);
    const back = versionChange(versions, 2, of);
    expect([back.kind, back.from, changedSections(back.changes!)]).toEqual(['restore', 1, ['s01 钩子', 's03 涂卡']]);
    expect(versionChange(versions, 1, (r) => (r === 'r1' ? null : of(r))).changes).toBeNull();
  });
});

describe('脚本的比对', () => {
  it('按空行切块，标题单独成块', () => {
    const b = scriptBlocks('## 标题\n正文一行\n第二行\n\n- 列表');
    expect(b.map((x) => x.text)).toEqual(['## 标题', '正文一行\n第二行', '- 列表']);
    expect(b[0]!.heading).toBe('标题');
    expect(b[1]!.heading).toBeNull();
  });

  it('改过的一段并成 changed，新加的小节是 added；第一版全是 same', () => {
    const d = scriptDiff(v1, v2);
    expect(d.map((x) => x.status)).toEqual(['same', 'same', 'changed', 'same', 'same', 'added', 'added']);
    expect(d[2]!.before).toBe('第一段旁白。');
    expect(changeCount(d)).toBe(3);
    expect(changedSections(d)).toEqual(['s01 钩子', 's03 涂卡']);
    expect(scriptDiff(null, v1).every((x) => x.status === 'same')).toBe(true);
  });

  it('删掉的块留在原位，标 removed', () => {
    expect(scriptDiff(v2, v1).map((x) => x.status)).toEqual(['same', 'same', 'changed', 'same', 'same', 'removed', 'removed']);
  });

  it('连着改了两块：两块都标 changed，不错配成删掉 + 新加', () => {
    const d = scriptDiff('## s01\n\n旧的一段。\n\n> 旧的备注', '## s01\n\n新的一段。\n\n> 新的备注');
    expect(d.map((x) => x.status)).toEqual(['same', 'changed', 'changed']);
    expect(d.map((x) => x.before ?? null)).toEqual([null, '旧的一段。', '> 旧的备注']);
  });

  it('标题之前的改动算「开头」（null）', () => {
    expect(changedSections(scriptDiff('前言。\n\n## s01\n\n正文', '前言改了。\n\n## s01\n\n正文'))).toEqual([null]);
  });
});

describe('当前段对到脚本的小节', () => {
  const b = scriptBlocks(v2);
  it('按章节号、段名或去掉章节号的标题', () => {
    expect(sectionFor(b, { title: '别的名字', chapterId: 's02' })).toBe(3);
    expect(sectionFor(b, { title: 's03 涂卡' })).toBe(5);
    expect(sectionFor(b, { title: '钩子' })).toBe(1);
  });
  it('对不上是 -1', () => {
    expect(sectionFor(b, { title: '对不上', chapterId: 's09' })).toBe(-1);
    expect(sectionFor(b, null)).toBe(-1);
  });
});
