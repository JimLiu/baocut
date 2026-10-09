import { describe, expect, it } from 'vitest';
import { compileFind, findRanges } from './text-find.ts';
import type { TranscriptWord } from './transcript-cut.ts';
import {
  chapterSections,
  copyReceipt,
  lengthReceipt,
  copyText,
  paragraphText,
  paragraphTranslations,
  replaceInParagraph,
  timeStamp,
  wordHighlights,
  writeTranscript,
  type CopyParagraph,
} from './transcript-text.ts';

/** 文稿里的词：只填拼文字要用的字段。 */
function w(index: number, id: string, text: string, spaced: boolean, state: TranscriptWord['state'] = 'kept'): TranscriptWord {
  return { id, index, text, spaced, state, start: index, end: index + 1, placements: [], paragraphStart: false };
}

const speech = (words: Array<{ id: string; text: string; start?: number; end?: number; hidden?: boolean }>, extra: Record<string, unknown> = {}) => ({
  schema: 'baocut.speech/1',
  clock: 'source-asset',
  timescale: 1_000_000,
  speakers: [],
  words: words.map((word, n) => ({ start: n * 1_000_000, end: (n + 1) * 1_000_000, ...word })),
  sentences: null,
  ...extra,
});

const texts = (body: Record<string, unknown> | undefined) => (body?.words as Array<{ text: string; hidden?: boolean }>).map((x) => (x.hidden ? null : x.text));

function replaceAll(body: unknown, words: TranscriptWord[], query: string, replacement: string) {
  const para = paragraphText(words);
  const { re } = compileFind(query, { matchCase: false, wholeWord: false, regex: false });
  return replaceInParagraph(body, para, findRanges(para.text, re!, false), replacement);
}

describe('时间码', () => {
  it('mm:ss 向下取整，一小时以上 hh:mm:ss（与导出的文稿同一个写法）', () => {
    expect([timeStamp(0), timeStamp(65.9), timeStamp(599.99), timeStamp(3723), timeStamp(-2)]).toEqual([
      '00:00',
      '01:05',
      '09:59',
      '01:02:03',
      '00:00',
    ]);
  });
});

describe('一段的文字', () => {
  it('词去掉首尾空白，spaced 的词前空一格；整个剪掉的词不算，选区复制时算', () => {
    const words = [w(0, 'a', ' Hello', false), w(1, 'b', ' big', true, 'cut'), w(2, 'c', ' world', true), w(3, 'd', '.', false)];
    expect(paragraphText(words)).toEqual({
      text: 'Hello world.',
      words: [
        { id: 'a', index: 0, start: 0, end: 5 },
        { id: 'c', index: 2, start: 6, end: 11 },
        { id: 'd', index: 3, start: 11, end: 12 },
      ],
    });
    expect(paragraphText(words, true).text).toBe('Hello big world.');
    expect(paragraphText([w(0, 'x', '你好', false), w(1, 'y', '世界', false)]).text).toBe('你好世界');
  });
});

describe('命中摊到词上', () => {
  it('词内按词的偏移给；盖住词间空格时标在后一个词前面；当前那一处单独标', () => {
    const para = paragraphText([w(0, 'a', ' Hello', false), w(1, 'b', ' big', true, 'cut'), w(2, 'c', ' world', true), w(3, 'd', '.', false)]);
    const marks = wordHighlights(para, [
      { start: 4, end: 7, current: true },
      { start: 11, end: 12 },
    ]);
    expect(marks.get(0)).toEqual({ ranges: [{ start: 4, end: 5, current: true }], gap: 0 });
    expect(marks.get(1)).toBeUndefined();
    expect(marks.get(2)).toEqual({ ranges: [{ start: 0, end: 1, current: true }], gap: 2 });
    expect(marks.get(3)).toEqual({ ranges: [{ start: 0, end: 1, current: false }], gap: 0 });
  });
});

describe('替换', () => {
  it('命中在一个词里只改这个词；一个词里几处一起改；保留前导空白', () => {
    const body = speech([
      { id: 'a', text: ' banana' },
      { id: 'b', text: ' split' },
    ]);
    const words = [w(0, 'a', ' banana', false), w(1, 'b', ' split', true)];
    const result = replaceAll(body, words, 'an', 'AN');
    expect(result?.changed).toBe(2);
    expect(texts(result?.body)).toEqual([' bANANa', ' split']);
  });

  it('跨词：块数对得上时一一落到词上，对不上时落到第一个词、其余隐藏', () => {
    const body = speech([
      { id: 'a', text: ' Jim' },
      { id: 'b', text: ' Lu' },
      { id: 'c', text: ' said' },
    ]);
    const words = [w(0, 'a', ' Jim', false), w(1, 'b', ' Lu', true), w(2, 'c', ' said', true)];
    expect(texts(replaceAll(body, words, 'jim lu', 'Jim Liu')?.body)).toEqual([' Jim', ' Liu', ' said']);
    expect(texts(replaceAll(body, words, 'm l', 'X')?.body)).toEqual([' JiXu', null, ' said']);
    expect(texts(replaceAll(body, words, 'jim lu', '')?.body)).toEqual([null, null, ' said']);
  });

  it('盖住了词间空格的命中把两边的词并起来；中文跨词落到第一个词', () => {
    const body = speech([
      { id: 'a', text: ' open' },
      { id: 'b', text: ' AI' },
    ]);
    const words = [w(0, 'a', ' open', false), w(1, 'b', ' AI', true)];
    expect(texts(replaceAll(body, words, ' ', '')?.body)).toEqual([' openAI', null]);
    expect(texts(replaceAll(body, words, 'n ', 'n-')?.body)).toEqual([' open-AI', null]);

    const zh = speech([
      { id: 'x', text: '你' },
      { id: 'y', text: '好' },
      { id: 'z', text: '吗' },
    ]);
    const zhWords = [w(0, 'x', '你', false), w(1, 'y', '好', false), w(2, 'z', '吗', false)];
    expect(texts(replaceAll(zh, zhWords, '你好', '您好')?.body)).toEqual(['您好', null, '吗']);
  });

  it('替换成一样的文字、没有命中时不写（null）；剪掉的词不参与', () => {
    const body = speech([
      { id: 'a', text: '一' },
      { id: 'b', text: '二' },
    ]);
    const words = [w(0, 'a', '一', false), w(1, 'b', '二', false, 'cut')];
    expect(replaceAll(body, words, '一', '一')).toBeNull();
    expect(replaceAll(body, words, '二', '三')).toBeNull();
    expect(replaceAll(body, words, '一', '壹')?.changed).toBe(1);
  });
});

describe('复制', () => {
  const paras: CopyParagraph[] = [
    { start: 12.6, speaker: '主持人', text: '大家好，欢迎收看。', translation: 'Hello everyone.' },
    { start: 65, speaker: null, text: 'Then we start.', translation: '然后我们开始。' },
  ];

  it('纯文字：段与段之间空一行', () => {
    expect(copyText(paras, { view: 'source' })).toBe('大家好，欢迎收看。\n\nThen we start.');
  });

  it('译文与双语：双语是原文一行、译文一行', () => {
    expect(copyText(paras, { view: 'translation' })).toBe('Hello everyone.\n\n然后我们开始。');
    expect(copyText(paras.slice(0, 1), { view: 'both' })).toBe('大家好，欢迎收看。\nHello everyone.');
  });

  it('按导出文稿的写法排（§4.4）：Markdown 说话人加粗、时间戳在段尾，标记字符转义', () => {
    const md = { format: 'md', view: 'source', speakers: true, timestamps: true } as const;
    expect(writeTranscript([{ chapter: null, paras }], md)).toBe('**主持人:** 大家好，欢迎收看。 [00:12]\n\nThen we start. [01:05]');
    expect(writeTranscript([{ chapter: null, paras: [{ ...paras[1]!, text: 'a*b_c #1' }] }], { ...md, timestamps: false })).toBe('a\\*b\\_c \\#1');
    // 双语的译文另起一块引用；只看译文时译文当正文写。
    expect(writeTranscript([{ chapter: null, paras: paras.slice(0, 1) }], { ...md, view: 'both', timestamps: false })).toBe(
      '**主持人:** 大家好，欢迎收看。\n\n> Hello everyone.',
    );
    expect(writeTranscript([{ chapter: null, paras }], { ...md, view: 'translation', speakers: false, timestamps: false })).toBe(
      'Hello everyone.\n\n然后我们开始。',
    );
  });

  it('纯文本：说话人后跟冒号，双语译文紧接下一行；标题只在 Markdown 写', () => {
    const txt = { format: 'txt', view: 'both', speakers: true, timestamps: false, title: '访谈' } as const;
    expect(writeTranscript([{ chapter: null, paras }], txt)).toBe('主持人: 大家好，欢迎收看。\nHello everyone.\n\nThen we start.\n然后我们开始。');
    expect(writeTranscript([{ chapter: null, paras: paras.slice(1) }], { ...txt, format: 'md', view: 'source' })).toBe('# 访谈\n\nThen we start.');
  });

  it('章节：Markdown 是二级标题（带时间戳时加 · mm:ss），纯文本是 — 名字 —；正文是空的段与没有段的章不写', () => {
    const sections = [
      { chapter: { title: '开场', start: 0 }, paras: paras.slice(0, 1) },
      { chapter: { title: '空章', start: 30 }, paras: [{ ...paras[1]!, text: ' ' }] },
      { chapter: { title: '正题\n第一部分', start: 60 }, paras: paras.slice(1) },
    ];
    expect(writeTranscript(sections, { format: 'md', view: 'source', speakers: false, timestamps: true })).toBe(
      '## 开场 · 00:00\n\n大家好，欢迎收看。 [00:12]\n\n## 正题 第一部分 · 01:00\n\nThen we start. [01:05]',
    );
    expect(writeTranscript(sections, { format: 'txt', view: 'source', speakers: false, timestamps: false })).toBe(
      '— 开场 —\n\n大家好，欢迎收看。\n\n— 正题 第一部分 —\n\nThen we start.',
    );
  });

  it('按章分节：段归它开始时已经开始的最后一章；第一章之前的段没有标题；同一章接着的段不重复标题', () => {
    const chapters = [
      { title: '一', start: 10 },
      { title: '二', start: 60 },
    ];
    const at = (start: number): CopyParagraph => ({ start, speaker: null, text: String(start), translation: '' });
    const sections = chapterSections([at(0), at(10), at(30), at(65), at(5)], chapters);
    expect(sections.map((s) => [s.chapter?.title ?? null, s.paras.map((p) => p.start)])).toEqual([
      [null, [0]],
      ['一', [10, 30]],
      ['二', [65, 5]],
    ]);
  });

  it('回执：段数加字数，中文按字、拉丁按词，哪种多按哪种', () => {
    expect(copyReceipt(paras, 'source')).toBe('2 段 · 7 字');
    expect(copyReceipt(paras.slice(1), 'source')).toBe('1 段 · 3 词');
    // 导出面板的篇幅：Runtime 数好的段数、汉字数与词数，同一个说法。
    expect(lengthReceipt(2, 7, 1)).toBe('2 段 · 7 字');
    expect(lengthReceipt(1, 0, 3)).toBe('1 段 · 3 词');
    expect(copyReceipt(paras, 'translation')).toBe('2 段 · 6 字');
  });
});

describe('译文按段', () => {
  const body = speech([
    { id: 'w1', text: '第一句。' },
    { id: 'w2', text: '第二' },
    { id: 'w3', text: '句。' },
    { id: 'w4', text: '第三句。', start: 9_000_000, end: 10_000_000 },
  ]);
  const translation = (units: Array<[string, string]>, language = 'en') => ({
    schema: 'baocut.translation/2',
    language,
    sourceBasis: {},
    units: units.map(([sourceSentenceId, naturalText], n) => ({
      id: `u${n}`,
      sourceSentenceId,
      sourceFingerprint: 'f',
      naturalText,
      alignment: null,
      status: 'draft',
    })),
  });

  it('一句归它第一个词所在的段，段里各句接起来；拉丁文字之间空一格，中文直接接', () => {
    const paras = [{ words: [{ id: 'w1' }, { id: 'w2' }] }, { words: [{ id: 'w3' }, { id: 'w4' }] }];
    expect(
      paragraphTranslations(
        body,
        translation([
          ['s-w1', 'One.'],
          ['s-w2', 'Two.'],
          ['s-w4', 'Three.'],
        ]),
        paras,
      ),
    ).toEqual(['One. Two.', 'Three.']);
    expect(
      paragraphTranslations(
        body,
        translation(
          [
            ['s-w1', '一。'],
            ['s-w2', '二。'],
          ],
          'zh',
        ),
        paras,
      ),
    ).toEqual(['一。二。', '']);
  });

  it('拆开的未计时段按原词认；认不出的正文返回 null', () => {
    expect(paragraphTranslations(body, translation([['s-w4', 'Three.']]), [{ words: [{ id: 'w4~2' }] }])).toEqual(['Three.']);
    expect(paragraphTranslations(body, { schema: 'baocut.translation/1' }, [])).toBeNull();
  });
});
