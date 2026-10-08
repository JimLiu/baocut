import { describe, expect, it } from 'vitest';
import type { TranslationGlossary } from '@baocut/protocol';
import {
  addTranscriptionTerms,
  addTranslationTerms,
  addedText,
  canonicalLanguage,
  exportFileName,
  glossaryNameProblem,
  languageOptions,
  newTranslationGlossary,
  normKey,
  pairLabel,
  parseTranscriptionLines,
  parseTranslationLines,
  reverseTranslation,
  sameLanguage,
  searchTerms,
  splitMisheard,
  tidyTranscriptionTerm,
  tidyTranslationTerm,
  transcriptionTermProblems,
  translationTermProblems,
} from './library-glossary.ts';

describe('归并键与误写', () => {
  it('大小写、空白与 ASCII 标点不算区别', () => {
    expect(normKey('KV cache')).toBe(normKey('kv-cache'));
    expect(normKey(' KV Cache ')).toBe('kvcache');
    expect(normKey('……')).toBe('……');
    expect(normKey('--')).toBe('');
  });

  it('误写按逗号、顿号、分号拆开并去重', () => {
    expect(splitMisheard('开维缓存、KV 换成, 开维缓存；凯威')).toEqual(['开维缓存', 'KV 换成', '凯威']);
    expect(splitMisheard('  ')).toEqual([]);
  });
});

describe('语言', () => {
  it('BCP 47 的规范写法；不合法时 null', () => {
    expect(canonicalLanguage('zh-hans')).toBe('zh-Hans');
    expect(canonicalLanguage('not a tag')).toBeNull();
    expect(canonicalLanguage('')).toBeNull();
  });

  it('下拉补上当前值里不在常备表里的语言', () => {
    const options = languageOptions(['zh', 'nl', null]);
    expect(options.filter((tag) => tag === 'zh')).toHaveLength(1);
    expect(options.at(-1)).toBe('nl');
  });

  it('同一门语言按主语种比', () => {
    expect(sameLanguage('zh-Hans', 'zh')).toBe(true);
    expect(sameLanguage('en', 'zh')).toBe(false);
    expect(sameLanguage(null, 'zh')).toBe(false);
  });

  it('方向标签：不限的源语言写「任意语言」', () => {
    const table = newTranslationGlossary(null, 'en');
    expect(table.name).toBe('任意语言 → English');
    expect(pairLabel({ ...table, sourceLanguage: 'zh' })).toBe('中文 → English');
    expect(pairLabel({ name: 'x', kind: 'transcription', language: null, defaultEnabled: true, terms: [] })).toBe('任意语言');
  });
});

describe('校验', () => {
  it('转录术语：规范写法必填，同一个词不能出现两次，误写不能等于规范写法', () => {
    expect(transcriptionTermProblems({ canonical: ' ', misheard: [] }, [])).toEqual(['规范写法不能为空']);
    expect(transcriptionTermProblems({ canonical: 'KV cache', misheard: [] }, [{ canonical: 'kv-cache', misheard: [] }])).toEqual([
      '表里已经有「kv-cache」',
    ]);
    expect(transcriptionTermProblems({ canonical: 'LoRA', misheard: ['lora'] }, [])).toEqual(['常听错成的写法不能和规范写法相同']);
    expect(transcriptionTermProblems({ canonical: 'a'.repeat(201), misheard: [] }, [])).toEqual(['规范写法不能超过 200 个字']);
    expect(transcriptionTermProblems({ canonical: 'LoRA', misheard: Array.from({ length: 51 }, (_, i) => `x${i}`) }, [])).toEqual([
      '常听错成的写法最多 50 个',
    ]);
  });

  it('翻译术语：原文与译文都必填，备注有上限', () => {
    expect(translationTermProblems({ source: 'commit', target: '', note: null }, [])).toEqual(['译文不能为空']);
    expect(translationTermProblems({ source: 'Commit', target: '提交', note: null }, [{ source: 'commit', target: 'x', note: null }])).toEqual([
      '表里已经有「commit」',
    ]);
    expect(translationTermProblems({ source: 'a', target: 'b', note: 'n'.repeat(1001) }, [])).toEqual(['备注不能超过 1000 个字']);
  });

  it('表名', () => {
    expect(glossaryNameProblem('  ')).toBe('表名不能为空');
    expect(glossaryNameProblem('产品术语')).toBeNull();
  });

  it('保存前整理：误写去重、去掉与规范写法相同的；空备注写 null', () => {
    expect(tidyTranscriptionTerm({ canonical: ' LoRA ', misheard: ['罗拉', ' 罗拉', 'LoRA', ''] })).toEqual({ canonical: 'LoRA', misheard: ['罗拉'] });
    expect(tidyTranslationTerm({ source: ' a ', target: ' b ', note: '  ' })).toEqual({ source: 'a', target: 'b', note: null });
  });
});

describe('一次粘一批', () => {
  it('转录表：一行一条，误写可省；同一批里重复的词并成一条', () => {
    const { terms, skipped } = parseTranscriptionLines('KV cache = 开维缓存、KV 换成\nLoRA → 罗拉\n推理框架\nkv-cache = 凯威\n---\n');
    expect(terms).toEqual([
      { canonical: 'KV cache', misheard: ['开维缓存', 'KV 换成', '凯威'] },
      { canonical: 'LoRA', misheard: ['罗拉'] },
      { canonical: '推理框架', misheard: [] },
    ]);
    expect(skipped).toEqual([{ line: 'kv-cache = 凯威', why: '和前面的行是同一个词，已合并' }]);
  });

  it('翻译表：第三格是备注，没有译文的行退回来', () => {
    const { terms, skipped } = parseTranslationLines('commit = 突破确认\nspring = 弹簧效应 = 不要译成「泉水」\nWyckoff\nsign,标志');
    expect(terms).toEqual([
      { source: 'commit', target: '突破确认', note: null },
      { source: 'spring', target: '弹簧效应', note: '不要译成「泉水」' },
      { source: 'sign', target: '标志', note: null },
    ]);
    expect(skipped).toEqual([{ line: 'Wyckoff', why: '没有译文' }]);
  });

  it('Markdown 表按表头认列，front matter 与分隔行跳过（导出的文件可以直接粘回来）', () => {
    const markdown = [
      '---',
      'format: baocut.glossary',
      'name: "产品术语"',
      '---',
      '',
      '| Source | Target | Note |',
      '| --- | --- | --- |',
      '| a\\|b | 甲 | |',
      '| commit | 提交 | 版本库里 |',
    ].join('\n');
    expect(parseTranslationLines(markdown).terms).toEqual([
      { source: 'a|b', target: '甲', note: null },
      { source: 'commit', target: '提交', note: '版本库里' },
    ]);
    const asr = parseTranscriptionLines('| Term | Misheard |\n| --- | --- |\n| BaoCut | 宝卡特, 包cut |');
    expect(asr.terms).toEqual([{ canonical: 'BaoCut', misheard: ['宝卡特', '包cut'] }]);
  });
});

describe('加词', () => {
  it('转录表：已有的词只并入新误写', () => {
    const result = addTranscriptionTerms(
      [{ canonical: 'LoRA', misheard: ['罗拉'] }],
      [
        { canonical: 'lora', misheard: ['洛拉'] },
        { canonical: 'KV cache', misheard: [] },
      ],
    );
    expect(result.terms).toEqual([
      { canonical: 'LoRA', misheard: ['罗拉', '洛拉'] },
      { canonical: 'KV cache', misheard: [] },
    ]);
    expect([result.added, result.merged, result.overflow]).toEqual([1, 1, 0]);
    expect(addedText(result)).toBe('已加 1 条 · 1 条表里已经有了');
  });

  it('翻译表：已有的词保留原译法', () => {
    const result = addTranslationTerms([{ source: 'commit', target: '提交', note: null }], [{ source: 'Commit', target: '突破确认', note: null }]);
    expect(result.terms).toEqual([{ source: 'commit', target: '提交', note: null }]);
    expect(addedText(result)).toBe('这几条表里已经有了');
  });
});

describe('搜索与反向', () => {
  const table: TranslationGlossary = {
    name: 'English → 中文',
    kind: 'translation',
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    defaultEnabled: true,
    terms: [
      { source: 'commit', target: '突破确认', note: '这一派里不是「提交」' },
      { source: 'spring', target: '弹簧效应', note: null },
      { source: 'Spring', target: '弹簧效应', note: null },
    ],
  };

  it('搜原文、译文与备注', () => {
    expect(searchTerms(table, '提交')).toEqual([0]);
    expect(searchTerms(table, 'SPR')).toEqual([1, 2]);
    expect(searchTerms(table, ' ')).toEqual([0, 1, 2]);
  });

  it('掉头生成反方向的表，译文相同的只留第一条；源语言不限时生成不了', () => {
    const reversed = reverseTranslation(table)!;
    expect(reversed.sourceLanguage).toBe('zh');
    expect(reversed.targetLanguage).toBe('en');
    expect(reversed.defaultEnabled).toBe(false);
    expect(reversed.terms.map((t) => [t.source, t.target])).toEqual([
      ['突破确认', 'commit'],
      ['弹簧效应', 'spring'],
    ]);
    expect(reverseTranslation({ ...table, sourceLanguage: null })).toBeNull();
  });

  it('导出的文件名', () => {
    expect(exportFileName('产品/术语')).toBe('产品 术语.md');
    expect(exportFileName('  ')).toBe('术语表.md');
  });
});
