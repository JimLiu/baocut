import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryStore } from '@baocut/runtime-storage/library';
import {
  ALL_TERMS,
  MAX_TERMS,
  glossaryChanged,
  glossaryRefOf,
  glossarySnapshot,
  languageMatches,
  promptTerms,
  resolveGlossaries,
  selectTerms,
  termOccurs,
  type GlossaryRef,
  type PromptTerm,
} from './translation-glossary.ts';

/**
 * 翻译用的术语表（架构设计 §7.9；视频格式规范 §5.3）：语言相配、术语出现的判断、每批带的术语有上限且只带相关的、
 * 去重的优先顺序、`glossaryRef` 与术语表改了之后哪几句过期；库里条目的解析对着临时目录里真实的 `LibraryStore`。
 */

const term = (source: string, target: string, entryId: string | null = 'glo_a'): PromptTerm => ({ source, target, entryId });

describe('术语的出现与每批的上限', () => {
  it('语言标签在子标签边界上相配', () => {
    expect(languageMatches('en', 'en-US')).toBe(true);
    expect(languageMatches('EN-us', 'en')).toBe(true);
    expect(languageMatches('zh-Hans', 'zh-Hant')).toBe(false);
    expect(languageMatches('en', 'eng')).toBe(false);
  });

  it('拉丁字母的写法要在词边界上，中文按子串，不分大小写', () => {
    expect(termOccurs('AI', 'He said AI is here')).toBe(true);
    expect(termOccurs('AI', 'He said it')).toBe(false);
    expect(termOccurs('BaoCut', '我们用baocut剪辑')).toBe(true);
    expect(termOccurs('Final Cut', 'open final cut pro')).toBe(true);
    expect(termOccurs('剪辑', '今天讲剪辑技巧')).toBe(true);
    expect(termOccurs('C++', 'I write C++ daily')).toBe(true);
    expect(termOccurs('  ', 'anything')).toBe(false);
  });

  it('条数不多时每批带全部；多了只带这一批出现的，按优先顺序截到上限并报告截掉几条', () => {
    const few = Array.from({ length: ALL_TERMS }, (_, i) => term(`word${i}`, `词${i}`));
    expect(selectTerms(few, 'nothing relevant')).toEqual({ terms: few, capped: 0 });

    const many = Array.from({ length: 200 }, (_, i) => term(`word${i}`, `词${i}`));
    const picked = selectTerms(many, 'here are word3 and word150, not word');
    expect(picked).toEqual({ terms: [many[3], many[150]], capped: 0 });

    const text = many.map((t) => t.source).join(' ');
    const capped = selectTerms(many, text);
    expect(capped.terms).toHaveLength(MAX_TERMS);
    expect(capped.terms[0]).toBe(many[0]);
    expect(capped.capped).toBe(200 - MAX_TERMS);

    // 字符数也有上限：很长的术语放不下几条。
    const long = Array.from({ length: 40 }, (_, i) => term(`long${i}`, 'x'.repeat(500)));
    const limited = selectTerms(long, long.map((t) => t.source).join(' '));
    expect(limited.terms.length).toBeLessThan(10);
    expect(limited.terms.length + limited.capped).toBe(40);
  });

  it('去重：调用时给的优先，其次调用时给的库里的，最后视频启用的；同一写法不分大小写只留第一条', () => {
    const terms = promptTerms({
      inline: [{ source: 'Cut', target: '剪（调用时）' }],
      entries: [
        {
          library: 'glossaries',
          id: 'glo_v',
          version: 1,
          contentHash: 'h',
          name: 'v',
          origin: 'video',
          terms: [{ source: 'track', target: '轨（视频）', note: null }],
        },
        {
          library: 'glossaries',
          id: 'glo_e',
          version: 1,
          contentHash: 'h',
          name: 'e',
          origin: 'explicit',
          terms: [
            { source: 'cut', target: '剪（库）', note: null },
            { source: 'Track', target: '轨道（库）', note: '名词' },
          ],
        },
      ],
    });
    expect(terms).toEqual([
      { source: 'Cut', target: '剪（调用时）', entryId: null },
      { source: 'Track', target: '轨道（库）', note: '名词', entryId: 'glo_e' },
    ]);
  });
});

describe('glossaryRef 与术语表改了之后的过期', () => {
  const snapshot = {
    inline: [{ source: 'BaoCut', target: '宝剪' }],
    entries: [
      {
        library: 'glossaries' as const,
        id: 'glo_a',
        version: 2,
        contentHash: 'sha256:a2',
        name: '产品词',
        origin: 'video' as const,
        terms: [
          { source: 'timeline', target: '时间线', note: null },
          { source: 'clip', target: '片段', note: null },
          { source: 'render', target: '渲染', note: null },
        ],
      },
    ],
  };
  const source = 'Open the timeline in BaoCut.\nTrim the clip.\nThen export.';

  it('记下条目、版本与原文里出现过的术语（没出现的不记）', () => {
    const ref = glossaryRefOf(snapshot, source)!;
    expect(ref.entries).toEqual([{ library: 'glossaries', id: 'glo_a', version: 2, contentHash: 'sha256:a2', name: '产品词' }]);
    expect(ref.inline).toMatchObject({ count: 1, contentHash: expect.stringMatching(/^sha256:/) });
    expect(ref.terms).toEqual([
      { entryId: null, source: 'BaoCut', target: '宝剪' },
      { entryId: 'glo_a', source: 'timeline', target: '时间线' },
      { entryId: 'glo_a', source: 'clip', target: '片段' },
    ]);
    expect(glossaryRefOf({ inline: [], entries: [] }, source)).toBeNull();
  });

  it('表没变时都不过期；改了译法只让含这条术语的句子过期；新加的术语出现在句子里也算；删了表时含它的术语的句子过期', () => {
    const ref = glossaryRefOf(snapshot, source) as GlossaryRef;
    const terms = snapshot.entries[0]!.terms;
    const now = (contentHash: string, list: typeof terms) => () => ({ contentHash, terms: list });
    expect(glossaryChanged(ref, 'Open the timeline in BaoCut.', now('sha256:a2', terms))).toBe(false);

    const renamed = terms.map((t) => (t.source === 'clip' ? { ...t, target: '剪辑片段' } : t));
    expect(glossaryChanged(ref, 'Trim the clip.', now('sha256:a3', renamed))).toBe(true);
    expect(glossaryChanged(ref, 'Open the timeline in BaoCut.', now('sha256:a3', renamed))).toBe(false);

    const added = [...terms, { source: 'export', target: '导出', note: null }];
    expect(glossaryChanged(ref, 'Then export.', now('sha256:a3', added))).toBe(true);

    expect(glossaryChanged(ref, 'Open the timeline in BaoCut.', () => null)).toBe(true);
    // 调用时直接给的术语不受库的影响。
    expect(glossaryChanged(ref, 'BaoCut only.', () => null)).toBe(false);
  });
});

describe('解析库里的术语表', () => {
  let dir: string;
  let library: LibraryStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-glossary-'));
    library = await LibraryStore.open({ dir });
  });

  afterEach(async () => {
    await library.idle();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const translation = (name: string, targetLanguage: string, sourceLanguage: string | null = null) =>
    library.put({
      library: 'glossaries',
      content: {
        name,
        kind: 'translation',
        sourceLanguage,
        targetLanguage,
        defaultEnabled: false,
        terms: [{ source: name, target: `${name}译`, note: null }],
      },
    });

  it('调用时给的在前；视频启用的删了或语言不符时跳过并记下，转写用的不报；对外服务的客户端只能用调用时直接给的术语', async () => {
    const zh = (await translation('zh 表', 'zh-CN', 'en')).entry;
    const en = (await translation('en 表', 'en')).entry;
    const other = (await translation('另一张', 'zh')).entry;
    const asr = (
      await library.put({
        library: 'glossaries',
        content: {
          name: '转写',
          kind: 'transcription',
          language: null,
          defaultEnabled: false,
          terms: [{ canonical: 'BaoCut', misheard: [] }],
        },
      })
    ).entry;
    const base = { library, targetLanguage: 'zh-CN', sourceLanguage: 'en', submitter: { kind: 'connection', id: 'c' } as const };

    const resolved = resolveGlossaries({ ...base, explicit: [{ id: other.id }], enabled: [zh.id, en.id, asr.id, 'glo_gone', other.id] });
    expect(resolved.entries.map((e) => [e.id, e.origin, e.version])).toEqual([
      [other.id, 'explicit', 1],
      [zh.id, 'video', 1],
    ]);
    expect(resolved.skipped).toEqual([
      { id: en.id, reason: 'language' },
      { id: 'glo_gone', reason: 'removed' },
    ]);
    const snapshot = glossarySnapshot(library, [], resolved.entries);
    expect(snapshot.entries.map((e) => e.terms[0]!.target)).toEqual(['另一张译', 'zh 表译']);

    // 调用时给的不合时拒绝：语言不符、转写用的、重复。
    for (const explicit of [[{ id: en.id }], [{ id: asr.id }], [{ id: zh.id }, { id: zh.id }]]) {
      expect(() => resolveGlossaries({ ...base, explicit, enabled: [] })).toThrow(expect.objectContaining({ code: 'invalid-request' }));
    }
    expect(() => resolveGlossaries({ ...base, explicit: [{ id: 'glo_gone' }], enabled: [] })).toThrow(
      expect.objectContaining({ code: 'not-found' }),
    );
    // 对外服务：给了库里的术语表时拒绝；视频启用的不用。
    const service = { kind: 'service', id: 'svc', clientId: 'client_1' } as const;
    expect(() => resolveGlossaries({ ...base, submitter: service, explicit: [{ id: zh.id }], enabled: [] })).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ code: 'LIBRARY_ENTRY_NOT_APPLICABLE' }) }),
    );
    expect(resolveGlossaries({ ...base, submitter: service, explicit: [], enabled: [zh.id] })).toEqual({ entries: [], skipped: [] });
  });
});
