import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assColor, assStyleMapping } from './ass-style.ts';
import { duckingExpression, envelopeExpression, filterScriptOption, gainExpression, mixArgs } from './audio-export.ts';
import type { AudioPlan, AudioSegment, PlannedAsset, PlannedDocument, TextEntry, TextPlan } from './export-plan.ts';
import {
  DestinationError,
  candidateName,
  checkFixedName,
  prepareDirectory,
  publishFile,
  safeFileStem,
  withExtension,
} from './export-publish.ts';
import { editorWasmAvailable, sourceSentences } from '@baocut/jobs';
import { checkText, displayWidth, renderText, wrapLines, type TextExportInput } from './text-export.ts';
import { sourceChapters, sourcePlan } from './text-source.ts';
import { JobsSpeechDocument } from '@baocut/protocol/messages/jobs/speech-document.ts';

/** 导出的纯函数部分：不需要引擎与 ffmpeg，总是运行。 */

const RANGE = { startSeconds: 0, endSeconds: 10, durationSeconds: 10 };

function doc(documentId: string, kind: string, extra: Partial<PlannedDocument> = {}): PlannedDocument {
  return {
    documentId,
    kind,
    name: documentId,
    language: 'en',
    revision: '1',
    sourceAssetId: null,
    sourceDocumentId: null,
    schema: kind === 'caption' ? 'baocut.caption/1' : kind === 'translation' ? 'baocut.translation/1' : 'baocut.speech/1',
    body: null,
    ...extra,
  };
}

function plan(
  unit: 'caption' | 'speech',
  entries: Array<Partial<TextEntry> & { id: string; start: number; end: number; text: string }>,
): TextPlan {
  return {
    sequenceId: 'seq',
    documentId: 'doc',
    unit,
    clock: 'source-asset',
    scope: { basis: 'items', captionItemIds: [], scopeItemIds: ['item'] },
    range: RANGE,
    entries: entries.map((e) => ({ key: `item:${e.id}`, scopeItemId: 'item', wordTiming: unit === 'speech', ...e })),
    sourceCount: entries.length,
    omittedCount: 0,
  };
}

function input(overrides: Partial<TextExportInput> & Pick<TextExportInput, 'format' | 'primary'>): TextExportInput {
  return {
    kind: 'subtitles',
    secondary: null,
    style: null,
    canvas: { width: 1920, height: 1080 },
    meta: { videoId: 'vid', videoName: '测试', videoRevision: '3', sequenceId: 'seq', sequenceRevision: '2' },
    rangeDuration: 10,
    ...overrides,
  };
}

const SPEECH = plan('speech', [
  { id: 'w1', start: 0, end: 0.5, text: 'Hello', sentenceId: 's1' },
  { id: 'w2', start: 0.5, end: 1, text: 'world.', sentenceId: 's1' },
  { id: 'w3', start: 2, end: 2.5, text: 'Second', sentenceId: 's2' },
  { id: 'w4', start: 2.5, end: 3, text: 'line.', sentenceId: 's2' },
]);

describe('字幕与文稿', () => {
  it('显示宽度与换行：全角算 2，按宽度折行', () => {
    expect(displayWidth('ab中文')).toBe(6);
    const lines = wrapLines('one two three four five six seven', 10);
    expect(lines.every((l) => displayWidth(l) <= 10)).toBe(true);
    expect(lines.join(' ')).toBe('one two three four five six seven');
    expect(wrapLines('一二三四五六七八九十', 8).every((l) => displayWidth(l) <= 8)).toBe(true);
  });

  it('SRT：按句成条，序号从 1 开始，毫秒时间；箭头被转义', () => {
    const out = renderText(input({ format: 'srt', primary: { document: doc('d', 'speech'), plan: SPEECH } }));
    expect(out.entries).toBe(2);
    expect(out.content).toBe('1\n00:00:00,000 --> 00:00:01,000\nHello world.\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond line.\n');
    expect(checkText('srt', out.content, { entries: 2, durationSec: 10 })).toMatchObject({ ok: true, entries: 2 });

    const arrow = renderText(
      input({
        format: 'srt',
        primary: { document: doc('c', 'caption'), plan: plan('caption', [{ id: 'c1', start: 0, end: 1, text: 'a --> b' }]) },
      }),
    );
    expect(arrow.content).not.toContain('a --> b');
    expect(checkText('srt', arrow.content, { entries: 1, durationSec: 10 }).ok).toBe(true);
  });

  it('VTT：头部与转义；校验发现条数不对、时间倒退', () => {
    const caption = plan('caption', [{ id: 'c1', start: 1, end: 2, text: '<b>A & B</b>' }]);
    const out = renderText(input({ format: 'vtt', primary: { document: doc('c', 'caption'), plan: caption } }));
    expect(out.content.startsWith('WEBVTT\n')).toBe(true);
    expect(out.content).toContain('&lt;b&gt;A &amp; B&lt;/b&gt;');
    expect(checkText('vtt', out.content, { entries: 2, durationSec: 10 }).ok).toBe(false);
    const backwards = 'WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nx\n';
    expect(checkText('vtt', backwards, { entries: 1, durationSec: 10 }).ok).toBe(false);
    const beyond = '1\n00:00:00,000 --> 00:00:12,000\nx\n';
    expect(checkText('srt', beyond, { entries: 1, durationSec: 10 }).ok).toBe(false);
  });

  it('长句按宽度与 7 秒拆成几条，拆点的时间来自词', () => {
    const words = Array.from({ length: 30 }, (_, i) => ({
      id: `w${i}`,
      start: i * 0.5,
      end: i * 0.5 + 0.5,
      text: `word${i}`,
      sentenceId: 's',
    }));
    const out = renderText(
      input({ format: 'srt', primary: { document: doc('d', 'speech'), plan: plan('speech', words) }, maxCharsPerLine: 20 }),
    );
    expect(out.entries).toBeGreaterThan(2);
    const check = checkText('srt', out.content, { entries: out.entries, durationSec: 15 });
    expect(check.ok).toBe(true);
    for (const block of out.content.trim().split('\n\n')) {
      const lines = block.split('\n').slice(2);
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(lines.every((l) => displayWidth(l) <= 20)).toBe(true);
    }
  });

  it('JSON：全部可信时写逐词时间；字幕文档没有词时间', () => {
    const speech = JSON.parse(renderText(input({ format: 'json', primary: { document: doc('d', 'speech'), plan: SPEECH } })).content) as {
      schema: string;
      wordTiming: string;
      segments: Array<{ words?: unknown[] }>;
    };
    expect(speech.schema).toBe('baocut.export.text/1');
    expect(speech.wordTiming).toBe('word');
    expect(speech.segments[0]!.words).toHaveLength(2);

    const caption = plan('caption', [{ id: 'c1', start: 0, end: 1, text: '整句' }]);
    const sentence = JSON.parse(
      renderText(input({ format: 'json', primary: { document: doc('c', 'caption'), plan: caption } })).content,
    ) as {
      wordTiming: string;
      segments: Array<{ words?: unknown[] }>;
    };
    expect(sentence.wordTiming).toBe('none');
    expect(sentence.segments[0]!.words).toBeUndefined();
  });

  it('双语：译文按句配上；被剪得不完整的句子不配，并提醒', () => {
    const body = {
      words: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }, { id: 'w4' }, { id: 'w5' }],
      sentences: [
        { id: 's1', wordIds: ['w1', 'w2'] },
        { id: 's2', wordIds: ['w3', 'w4', 'w5'] },
      ],
    };
    const translation = doc('t', 'translation', {
      language: 'zh',
      body: {
        units: [
          { id: 's1', text: '你好世界。' },
          { id: 's2', text: '第二行。' },
        ],
      },
    });
    const out = renderText(
      input({
        format: 'srt',
        primary: { document: doc('d', 'speech', { body }), plan: SPEECH },
        secondary: { document: translation, plan: null },
      }),
    );
    expect(out.content).toContain('Hello world.\n你好世界。');
    expect(out.content).not.toContain('第二行。');
    expect(out.warnings.map((w) => w.code)).toContain('TRANSLATION_SKIPPED_PARTIAL_SENTENCE');
  });

  it('双语（translation/2）：按 sourceSentenceId 配，显示改写优先，成员取 sourceWordIds，过期的单元不写', () => {
    const unit = (sid: string, naturalText: string, sourceWordIds: string[], extra: object = {}) => ({
      id: `t-${sid}`,
      sourceSentenceId: sid,
      sourceFingerprint: 'sha256:x',
      naturalText,
      alignment: { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds, textHash: 'sha256:y' },
      status: 'draft',
      ...extra,
    });
    const v2 = (units: object[]) =>
      doc('t', 'translation', { language: 'zh', schema: 'baocut.translation/2', body: { schema: 'baocut.translation/2', units } });
    // 转写没有存句子：句子按译文的词成员切，句内 1.5 秒的停顿不拆。
    const unsplit = plan('speech', [
      { id: 'w1', start: 0, end: 0.5, text: 'Hello' },
      { id: 'w2', start: 2, end: 2.5, text: 'world.' },
      { id: 'w3', start: 3, end: 3.5, text: 'Second' },
      { id: 'w4', start: 3.5, end: 4, text: 'line.' },
    ]);
    const out = renderText(
      input({
        format: 'srt',
        primary: { document: doc('d', 'speech', { body: { words: [], sentences: null } }), plan: unsplit },
        secondary: {
          document: v2([
            unit('s-w1', '你好世界。', ['w1', 'w2'], { displayRewrite: { text: '你好！', reason: '太长', reviewed: true } }),
            unit('s-w3', '第二行。', ['w3', 'w4'], { status: 'stale' }),
          ]),
          plan: null,
        },
      }),
    );
    expect(out.content).toContain('00:00:00,000 --> 00:00:02,500\nHello world.\n你好！');
    expect(out.content.trimEnd().endsWith('00:00:03,000 --> 00:00:04,000\nSecond line.')).toBe(true);
    expect(out.content).not.toContain('第二行。');
    expect(out.warnings.map((w) => w.code)).toEqual(['TRANSLATION_SKIPPED_STALE']);

    // 转写存了句子：按句子 ID 配；单元的词成员比剪剩的多时算不完整。
    const partial = renderText(
      input({
        format: 'srt',
        primary: { document: doc('d', 'speech', { body: { words: [], sentences: [] } }), plan: SPEECH },
        secondary: { document: v2([unit('s1', '你好世界。', ['w1', 'w2']), unit('s2', '第二行。', ['w3', 'w4', 'w5'])]), plan: null },
      }),
    );
    expect(partial.content).toContain('Hello world.\n你好世界。');
    expect(partial.content).not.toContain('第二行。');
    expect(partial.warnings.map((w) => w.code)).toEqual(['TRANSLATION_SKIPPED_PARTIAL_SENTENCE']);
  });

  it.skipIf(!editorWasmAvailable())(
    '双语（translation/2，alignment 为 null）：成员按翻译时的规则从转写的词得出，转写没存句子时每句照样配上译文',
    () => {
      // 智能体照 documents_read 写的译文：单元没有对齐；转写是 transcribe 写出的，`sentences` 为 null。
      const words = [
        { id: 'w1', text: 'Hello', start: 0, end: 500 },
        { id: 'w2', text: 'world.', start: 500, end: 1000 },
        { id: 'w3', text: 'Second', start: 3000, end: 3500 },
        { id: 'w4', text: 'line.', start: 3500, end: 4000 },
        { id: 'w5', text: 'Third', start: 6000, end: 6500 },
        { id: 'w6', text: 'one.', start: 6500, end: 7000 },
      ];
      const body = {
        schema: 'baocut.speech/1',
        clock: 'source-asset',
        timescale: 1000,
        speakers: [],
        words,
        sentences: null,
        chapters: [],
      };
      const read = sourceSentences(body);
      if ('problem' in read) throw new Error(read.problem);
      expect(read.sentences.map((s) => s.id)).toEqual(['s-w1', 's-w3', 's-w5']);
      const fingerprint = new Map(read.sentences.map((s) => [s.id, s.fingerprint]));
      const unit = (sid: string, naturalText: string, extra: object = {}) => ({
        id: `t-${sid}`,
        sourceSentenceId: sid,
        sourceFingerprint: fingerprint.get(sid)!,
        naturalText,
        alignment: null,
        status: 'draft',
        ...extra,
      });
      const v2 = (units: object[]) =>
        doc('t', 'translation', { language: 'zh', schema: 'baocut.translation/2', body: { schema: 'baocut.translation/2', units } });
      const SENTENCE_OF: Record<string, string> = { w1: 's-w1', w2: 's-w1', w3: 's-w3', w4: 's-w3', w5: 's-w5', w6: 's-w5' };
      const entries = (sentences: boolean) =>
        plan(
          'speech',
          words.map((w) => ({
            id: w.id,
            start: w.start / 1000,
            end: w.end / 1000,
            text: w.text,
            ...(sentences ? { sentenceId: SENTENCE_OF[w.id] } : {}),
          })),
        );
      const primary = { document: doc('d', 'speech', { body }), plan: entries(false) };
      const out = renderText(
        input({
          format: 'srt',
          primary,
          secondary: { document: v2([unit('s-w1', '你好世界。'), unit('s-w3', '第二行。'), unit('s-w5', '第三句。')]), plan: null },
        }),
      );
      expect(out.content).toContain('00:00:00,000 --> 00:00:01,000\nHello world.\n你好世界。');
      expect(out.content).toContain('00:00:03,000 --> 00:00:04,000\nSecond line.\n第二行。');
      expect(out.content).toContain('00:00:06,000 --> 00:00:07,000\nThird one.\n第三句。');
      expect(out.entries).toBe(3);
      expect(out.warnings).toEqual([]);

      // 原句改过（指纹与单元记下的不同）的单元不配，记为过期；其余照配。
      const changed = renderText(
        input({
          format: 'srt',
          primary,
          secondary: {
            document: v2([
              unit('s-w1', '你好世界。'),
              unit('s-w3', '第二行。', { sourceFingerprint: '2:w3:w4:zzz' }),
              unit('s-w5', '第三句。'),
            ]),
            plan: null,
          },
        }),
      );
      expect(changed.content).toContain('Hello world.\n你好世界。');
      expect(changed.content).not.toContain('第二行。');
      expect(changed.content).toContain('Third one.\n第三句。');
      expect(changed.warnings.map((w) => w.code)).toEqual(['TRANSLATION_SKIPPED_STALE']);

      // 转写存了句子（同样的 ID）：以前对齐为 null 的单元没有成员、整句算不完整；现在按得出的句子核对。
      const stored = renderText(
        input({
          format: 'srt',
          primary: { document: doc('d', 'speech', { body }), plan: entries(true) },
          secondary: { document: v2([unit('s-w1', '你好世界。'), unit('s-w3', '第二行。'), unit('s-w5', '第三句。')]), plan: null },
        }),
      );
      expect(stored.content).toContain('Hello world.\n你好世界。');
      expect(stored.content).toContain('Second line.\n第二行。');
      expect(stored.warnings).toEqual([]);
    },
  );

  it('双语：零时长的词放不上字幕，但不算剪掉——译文照配、不拆条；隐藏的词仍算剪掉', () => {
    const unit = (sid: string, naturalText: string, sourceWordIds: string[]) => ({
      id: `t-${sid}`,
      sourceSentenceId: sid,
      sourceFingerprint: 'sha256:x',
      naturalText,
      alignment: { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds, textHash: 'sha256:y' },
      status: 'draft',
    });
    const translation = doc('t', 'translation', {
      language: 'zh',
      schema: 'baocut.translation/2',
      body: { schema: 'baocut.translation/2', units: [unit('s-w1', '你好世界。', ['w1', 'w2', 'w3'])] },
    });
    // 规划（text_plan.rs）不出 w2：真实样本里对齐器把它的起止解到同一格。
    const placed = plan('speech', [
      { id: 'w1', start: 0, end: 0.5, text: 'Hello' },
      { id: 'w3', start: 0.5, end: 1, text: 'world.' },
    ]);
    const body = (w2: object) => ({
      schema: 'baocut.speech/1',
      timescale: 1_000_000,
      words: [{ id: 'w1', start: 0, end: 500_000, text: 'Hello' }, w2, { id: 'w3', start: 500_000, end: 1_000_000, text: 'world.' }],
      sentences: null,
    });
    const render = (w2: object) =>
      renderText(
        input({
          format: 'srt',
          primary: { document: doc('d', 'speech', { body: body(w2) }), plan: placed },
          secondary: { document: translation, plan: null },
        }),
      );
    const zero = render({ id: 'w2', start: 500_000, end: 500_000, text: 'there' });
    expect(zero.content).toContain('00:00:00,000 --> 00:00:01,000\nHello world.\n你好世界。');
    expect(zero.content.match(/-->/g)).toHaveLength(1);
    expect(zero.warnings).toEqual([]);

    const hidden = render({ id: 'w2', start: 500_000, end: 500_000, text: 'there', hidden: true });
    expect(hidden.content).not.toContain('你好世界。');
    expect(hidden.warnings.map((w) => w.code)).toEqual(['TRANSLATION_SKIPPED_PARTIAL_SENTENCE']);
  });

  it('文稿：段末写这一段开始的时间（不加反引号，满一小时 hh:mm:ss）；纯文本没有标记', () => {
    const transcript = { kind: 'transcript' as const, primary: { document: doc('d', 'speech'), plan: SPEECH } };
    const md = renderText(input({ ...transcript, format: 'md', timestamps: true }));
    expect(md.content).toBe('# 测试\n\nHello world. Second line. [00:00]\n');
    expect(checkText('md', md.content, { entries: md.entries, durationSec: 10 }).ok).toBe(true);
    const txt = renderText(input({ ...transcript, format: 'txt' }));
    expect(txt.content).toBe('Hello world. Second line.\n');
    expect(checkText('txt', txt.content, { entries: txt.entries, durationSec: 10 }).ok).toBe(true);
    expect(renderText(input({ ...transcript, format: 'txt', timestamps: true })).content).toBe('Hello world. Second line. [00:00]\n');

    const late = plan('speech', [
      { id: 'w1', start: 59.9, end: 60.4, text: 'One.' },
      { id: 'w2', start: 3725.2, end: 3726, text: 'Two.' },
    ]);
    const long = renderText(
      input({ kind: 'transcript', format: 'txt', timestamps: true, primary: { document: doc('d', 'speech'), plan: late } }),
    );
    expect(long.content).toBe('One. [00:59]\n\nTwo. [01:02:05]\n');
  });

  it('纯文本：正文长得像章节小标题（「— … —」）时照样算一段，校验按写出的小标题数扣', () => {
    const aside = plan('speech', [{ id: 'w1', start: 0, end: 1, text: '— Aside —' }]);
    const txt = renderText(input({ kind: 'transcript', format: 'txt', primary: { document: doc('d', 'speech'), plan: aside } }));
    expect(txt.content).toBe('— Aside —\n');
    expect(txt).toMatchObject({ entries: 1, headings: 0 });
    expect(checkText('txt', txt.content, { entries: txt.entries, durationSec: 10, headings: txt.headings })).toMatchObject({
      ok: true,
      entries: 1,
    });
    const chaptered = renderText(
      input({
        kind: 'transcript',
        format: 'txt',
        chapters: [{ title: 'Intro', start: 0 }],
        primary: { document: doc('d', 'speech'), plan: aside },
      }),
    );
    expect(chaptered.content).toBe('— Intro —\n\n— Aside —\n');
    expect(checkText('txt', chaptered.content, { entries: chaptered.entries, durationSec: 10, headings: chaptered.headings }).ok).toBe(
      true,
    );
  });

  it('文稿：章节小标题写在这一章的第一段前（章节处断段），没有段落的章不写；Markdown 与纯文本', () => {
    const chapters = [
      { title: 'Intro', start: 0 },
      { title: 'Empty', start: 1.5 },
      { title: 'Part *two*', start: 2 },
    ];
    const transcript = { kind: 'transcript' as const, chapters, primary: { document: doc('d', 'speech'), plan: SPEECH } };
    const md = renderText(input({ ...transcript, format: 'md', timestamps: true }));
    expect(md.content).toBe('# 测试\n\n## Intro · 00:00\n\nHello world. [00:00]\n\n## Part \\*two\\* · 00:02\n\nSecond line. [00:02]\n');
    expect(md.entries).toBe(2);
    expect(checkText('md', md.content, { entries: md.entries, durationSec: 10 }).ok).toBe(true);
    const txt = renderText(input({ ...transcript, format: 'txt', timestamps: true }));
    expect(txt.content).toBe('— Intro —\n\nHello world. [00:00]\n\n— Part *two* —\n\nSecond line. [00:02]\n');
    // 时间戳关掉时 Markdown 小标题也不带时刻。
    expect(renderText(input({ ...transcript, format: 'md' })).content).toBe(
      '# 测试\n\n## Intro\n\nHello world.\n\n## Part \\*two\\*\n\nSecond line.\n',
    );
    expect(txt.headings).toBe(2);
    expect(checkText('txt', txt.content, { entries: txt.entries, durationSec: 10, headings: txt.headings }).ok).toBe(true);
    // 不给章节时照常分段（同一段）。
    expect(renderText(input({ ...transcript, chapters: null, format: 'txt' })).entries).toBe(1);
  });

  it('文稿：文首元信息（只 Markdown）：字段按顺序、缺的不写、换行折成空格、JSON 转义，之后是说话人与章节表', () => {
    const speech = doc('d', 'speech', {
      body: {
        speakers: [
          { id: 'a', name: 'Ana' },
          { id: 'b', name: 'Ben "B"' },
        ],
      },
    });
    const two = plan('speech', [
      { id: 'w1', start: 0, end: 0.5, text: 'Hi.', speaker: 'a' },
      { id: 'w2', start: 3, end: 3.5, text: 'Hello.', speaker: 'b' },
      { id: 'w3', start: 6, end: 6.5, text: 'Bye.', speaker: 'a' },
    ]);
    const frontMatter = {
      title: 'ep "42"',
      description: null,
      source: 'https://x.example/42',
      author: '科浪电台',
      published: '2026-04-20',
      platform: 'YouTube',
      duration: '01:02:05',
      language: 'en',
      translation: '',
    };
    const chapters = [
      { title: '开场', start: 0 },
      { title: 'Q&A\nlive', start: 3 },
    ];
    const transcript = { kind: 'transcript' as const, frontMatter, chapters, primary: { document: speech, plan: two } };
    const md = renderText(input({ ...transcript, format: 'md' }));
    const [head] = md.content.split('\n\n# 测试');
    expect(head).toBe(
      [
        '---',
        'title: "ep \\"42\\""',
        'source: "https://x.example/42"',
        'author: "科浪电台"',
        'published: "2026-04-20"',
        'platform: "YouTube"',
        'duration: "01:02:05"',
        'language: "en"',
        'speakers:',
        '  - "Ana"',
        '  - "Ben \\"B\\""',
        'chapters:',
        '  - "[00:00] 开场"',
        '  - "[00:03] Q&A live"',
        '---',
      ].join('\n'),
    );
    expect(checkText('md', md.content, { entries: md.entries, durationSec: 10 }).ok).toBe(true);
    expect(md.entries).toBe(3);
    // 关掉说话人时文首也不列；纯文本不写文首。
    expect(renderText(input({ ...transcript, speakers: false, format: 'md' })).content).not.toContain('speakers:');
    expect(renderText(input({ ...transcript, format: 'txt' })).content).not.toContain('---');
  });

  it('文稿：双语时时间戳跟在原文段末，译文另起（Markdown 引用、纯文本下一行）', () => {
    const body = {
      speakers: [{ id: 'a', name: 'Ana' }],
      words: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }, { id: 'w4' }],
      sentences: [
        { id: 's1', wordIds: ['w1', 'w2'] },
        { id: 's2', wordIds: ['w3', 'w4'] },
      ],
    };
    const translation = doc('t', 'translation', {
      language: 'zh',
      body: {
        units: [
          { id: 's1', text: '你好世界。' },
          { id: 's2', text: '第二行。' },
        ],
      },
    });
    const spoken = plan(
      'speech',
      SPEECH.entries.map((e) => ({ ...e, speaker: 'a' })),
    );
    const pair = {
      kind: 'transcript' as const,
      timestamps: true,
      primary: { document: doc('d', 'speech', { body }), plan: spoken },
      secondary: { document: translation, plan: null },
    };
    const md = renderText(input({ ...pair, format: 'md' }));
    expect(md.content).toBe(`# 测试\n\n**Ana:** Hello world. Second line. [00:00]\n\n> 你好世界。第二行。\n`);
    expect(checkText('md', md.content, { entries: md.entries, durationSec: 10 }).ok).toBe(true);
    const txt = renderText(input({ ...pair, format: 'txt' }));
    expect(txt.content).toBe(`Ana: Hello world. Second line. [00:00]\n你好世界。第二行。\n`);
  });

  it('文稿不跳过剪掉的部分：从正文取原文（隐藏的词不要），时间是素材时钟；给了范围时取投影到的首尾之间；章节换到原文时钟', () => {
    const body = {
      timescale: 1000,
      words: [
        { id: 'w1', start: 0, end: 500, text: 'Hello' },
        { id: 'w2', start: 500, end: 1000, text: 'world.' },
        { id: 'w3', start: 5000, end: 5500, text: 'Cut' },
        { id: 'w4', start: 5500, end: 6000, text: 'part.', hidden: true },
        { id: 'w5', start: 6000, end: 6000, text: 'here.' },
        { id: 'w6', start: 9000, end: 9500, text: 'Kept', timingQuality: 'estimated' },
        { id: 'w7', start: 9500, end: 10000, text: 'end.' },
      ],
      sentences: [
        { id: 's1', wordIds: ['w1', 'w2'], paragraphStart: true },
        { id: 's2', wordIds: ['w3', 'w4', 'w5'] },
        { id: 's3', wordIds: ['w6', 'w7'], paragraphStart: true },
      ],
    };
    // 时间线上剪掉了 w3–w5：投影只有 w1、w2、w6、w7（w6 接在 1 秒处）。
    const projected = plan('speech', [
      { id: 'w1', start: 0, end: 0.5, text: 'Hello' },
      { id: 'w2', start: 0.5, end: 1, text: 'world.' },
      { id: 'w6', start: 1, end: 1.5, text: 'Kept' },
      { id: 'w7', start: 1.5, end: 2, text: 'end.' },
    ]);
    const whole = sourcePlan(body, projected, true);
    expect(whole.entries.map((e) => [e.id, e.start, e.end])).toEqual([
      ['w1', 0, 0.5],
      ['w2', 0.5, 1],
      ['w3', 5, 5.5],
      ['w5', 6, 6.08],
      ['w6', 9, 9.5],
      ['w7', 9.5, 10],
    ]);
    expect(whole.entries.find((e) => e.id === 'w6')!.wordTiming).toBe(false);
    expect(whole.entries.find((e) => e.id === 'w6')!.paragraphStart).toBe(true);
    expect(whole.range.durationSeconds).toBe(10);
    const txt = renderText(
      input({
        kind: 'transcript',
        format: 'txt',
        timestamps: true,
        rangeDuration: 10,
        primary: { document: doc('d', 'speech'), plan: whole },
      }),
    );
    expect(txt.content).toBe('Hello world. [00:00]\n\nCut here. [00:05]\n\nKept end. [00:09]\n');

    // 一段范围只投影到 w2…w6：原文取 w2 到 w6（中间剪掉的也在）。
    const part = sourcePlan(body, { ...projected, entries: projected.entries.slice(1, 3) }, false);
    expect(part.entries.map((e) => e.id)).toEqual(['w2', 'w3', 'w5', 'w6']);

    // 章节在序列 1 秒处（剪切点之后的第一个词是 w6）：原文里是 9 秒。之后没有文字的章节不要。
    expect(
      sourceChapters(
        [
          { title: 'A', start: 0 },
          { title: 'B', start: 1 },
          { title: 'C', start: 5 },
        ],
        projected,
        whole,
      ),
    ).toEqual([
      { title: 'A', start: 0 },
      { title: 'B', start: 9 },
    ]);

    // 字幕文档：句子按自己的时钟，空白与时间反了的不要。
    const captions = sourcePlan(
      {
        timescale: 10,
        cues: [
          { id: 'c1', start: 0, end: 10, text: 'One', speaker: 'a' },
          { id: 'c2', start: 20, end: 20, text: 'Bad' },
          { id: 'c3', start: 30, end: 40, text: ' ' },
          { id: 'c4', start: 50, end: 60, text: 'Two', paragraphStart: true },
        ],
      },
      plan('caption', [{ id: 'c4', start: 0, end: 1, text: 'Two' }]),
      true,
    );
    expect(captions.entries.map((e) => [e.id, e.start, e.end, e.speaker ?? null, e.paragraphStart ?? false])).toEqual([
      ['c1', 0, 1, 'a', false],
      ['c4', 5, 6, null, true],
    ]);
  });

  it('文稿：一个人讲到底也按停顿与篇幅分段，与文稿面板同一套规则', () => {
    // 没有存句子与段落的转写：一人独白。每句约 50 字，句间停 0.2 秒；第 8 句前停 2.5 秒。
    const sentence = 'This sentence is about fifty characters long, ok.'.split(' ');
    let t = 0;
    const words: Array<{ id: string; start: number; end: number; text: string; speaker: string }> = [];
    for (let s = 0; s < 10; s++) {
      if (s > 0) t += s === 7 ? 2.5 : 0.2;
      for (const text of sentence) {
        words.push({ id: `w${words.length + 1}`, start: t, end: t + 0.2, text, speaker: 'spk-1' });
        t += 0.2;
      }
    }
    const monologue = plan('speech', words);
    const md = renderText(
      input({ kind: 'transcript', format: 'md', primary: { document: doc('d', 'speech'), plan: monologue }, rangeDuration: t }),
    );
    const blocks = md.content.trim().split(/\n\n+/).slice(1);
    // 句末处满 240 字断一次（第 1–5 句一段），停顿 2.5 秒断一次（第 6–7 句、第 8–10 句）。
    expect(blocks).toHaveLength(3);
    expect(md.entries).toBe(3);
    expect(checkText('md', md.content, { entries: md.entries, durationSec: t }).ok).toBe(true);

    // 短句之间停顿稍长（0.6 秒以上）但这段还不到 60 字：不断。
    const short = plan('speech', [
      { id: 'a', start: 0, end: 0.5, text: 'Hi.' },
      { id: 'b', start: 1.2, end: 1.6, text: 'Okay.' },
    ]);
    expect(renderText(input({ kind: 'transcript', format: 'txt', primary: { document: doc('d', 'speech'), plan: short } })).entries).toBe(
      1,
    );
  });

  it('文稿：开着说话人时每段都写（只有一位也写），没名字的用默认名；关掉时都不写，JSON 也不带', () => {
    const speakers = {
      speakers: [
        { id: 'a', name: 'Ana' },
        { id: 'b', name: '' },
      ],
    };
    const speech = doc('d', 'speech', { body: speakers });
    const two = plan('speech', [
      { id: 'w1', start: 0, end: 0.5, text: 'Hi.', speaker: 'a' },
      { id: 'w2', start: 0.6, end: 1, text: 'Hello.', speaker: 'b' },
    ]);
    const md = renderText(input({ kind: 'transcript', format: 'md', primary: { document: speech, plan: two } }));
    expect(md.content).toBe(`# 测试\n\n**Ana:** Hi.\n\n**${JobsSpeechDocument.speakerName({ n: 2 }).text}:** Hello.\n`);
    const one = plan('speech', [{ id: 'w1', start: 0, end: 0.5, text: 'Hi.', speaker: 'a' }]);
    const solo = renderText(input({ kind: 'transcript', format: 'txt', primary: { document: speech, plan: one } }));
    expect(solo.content).toBe(`Ana: Hi.\n`);
    // 没有说话人的段落没有可写的名字。
    const nobody = renderText(input({ kind: 'transcript', format: 'txt', primary: { document: speech, plan: SPEECH } }));
    expect(nobody.content).toBe('Hello world. Second line.\n');

    const off = { kind: 'transcript' as const, speakers: false, primary: { document: speech, plan: two } };
    expect(renderText(input({ ...off, format: 'md' })).content).toBe('# 测试\n\nHi.\n\nHello.\n');
    expect(renderText(input({ ...off, format: 'txt' })).content).toBe('Hi.\n\nHello.\n');
    expect(renderText(input({ ...off, format: 'json' })).content).not.toContain('"speaker"');
    expect(renderText(input({ ...off, speakers: true, format: 'json' })).content).toContain('"speaker": "Ana"');
  });

  it('ASS：样式行、对话行的厘秒时间与转义', () => {
    const caption = plan('caption', [{ id: 'c1', start: 1.234, end: 2.5, text: '{\\b1}x' }]);
    const out = renderText(input({ format: 'ass', primary: { document: doc('c', 'caption'), plan: caption } }));
    expect(out.content).toContain('[Script Info]');
    expect(out.content).toContain('PlayResX: 1920');
    expect(out.content).toMatch(/Dialogue: 0,0:00:01\.23,0:00:02\.50,Default,/);
    expect(out.content).not.toContain('{\\b1}');
    expect(checkText('ass', out.content, { entries: 1, durationSec: 10 }).ok).toBe(true);
  });
});

describe('ASS 样式映射', () => {
  it('颜色换成 &HAABBGGRR', () => {
    expect(assColor('#ff8000', 'x')).toBe('&H000080FF');
    expect(assColor('rgba(0, 0, 255, 0.5)', 'x')).toBe('&H80FF0000');
    expect(assColor('nonsense', '&H00FFFFFF')).toBe('&H00FFFFFF');
  });

  it('认得的样式映射，表达不了的列出来；认不出的整份列出', () => {
    const mapping = assStyleMapping(
      {
        schema: 'baocut.legacy-studio-style/0.1',
        style: { fontSize: 30, fontColor: '#ffff00', bold: true, glow: { on: true }, lineHeight: 1.4 },
      },
      { width: 1080, height: 1920 },
    );
    expect(mapping.styles.default).toMatch(/^Style: Default,PingFang SC,60\.0,&H0000FFFF,/);
    expect(mapping.unmapped).toEqual(expect.arrayContaining(['glow', 'lineHeight']));
    expect(mapping.unmapped).not.toContain('fontSize');
    expect(assStyleMapping({ schema: 'other/1' }, { width: 1920, height: 1080 }).unmapped).toEqual(['整份样式（other/1）']);
    expect(assStyleMapping(null, { width: 1920, height: 1080 }).unmapped).toEqual([]);
  });
});

describe('音频混音参数', () => {
  const asset: PlannedAsset = {
    assetId: 'a',
    revision: '1',
    name: 'a.wav',
    path: '/media/a.wav',
    storage: 'linked',
    mediaType: 'audio/wav',
    contentHash: 'sha256:0',
    byteLength: 1,
    modifiedAt: null,
    audio: { sampleRate: 48000, channels: 1 },
  };
  const base: AudioPlan = {
    sequenceId: 'seq',
    sequenceRevision: '1',
    range: { startSeconds: 0, endSeconds: 2, durationSeconds: 2 },
    segments: [
      {
        itemId: 'i1',
        source: 'audio',
        asset: { id: 'a', revision: '1' },
        trackOrder: 0,
        start: 0.5,
        end: 1.5,
        sourceStart: 3,
        sourceRate: 2,
        gainDb: -6,
        fadeIn: { start: 0.5, end: 0.75 },
      },
    ],
    notes: [],
  };

  const script = { option: '-/filter_complex' as const, file: '/tmp/out.graph' };

  it('每段：取源、单声道铺到两声道、变速、按样本裁齐、增益、淡入、延后到位置；不归一化地混合', () => {
    const { args, graph } = mixArgs(base, new Map([['a@1', asset]]), 48000, 2, '/tmp/out.wav', script);
    expect(args).toEqual(expect.arrayContaining(['-ss', '3', '-t', '2.1', '-i', 'file:/media/a.wav']));
    expect(graph).toContain('pan=stereo|c0=c0|c1=c0');
    expect(graph).toContain('atempo=2');
    expect(graph).toContain('atrim=end_sample=48000');
    expect(graph).toContain('volume=-6dB');
    expect(graph).toContain('aeval=');
    expect(graph).toContain('adelay=delays=24000S:all=1');
    expect(graph).toContain('normalize=0');
    expect(graph).toContain('atrim=end_sample=96000');
  });

  it('没有冻结的素材是错误；没有片段时是一段静音', () => {
    expect(() => mixArgs(base, new Map(), 48000, 2, '/tmp/out.wav', script)).toThrow();
    const silent = mixArgs({ ...base, segments: [] }, new Map(), 44100, 1, '/tmp/out.wav', script);
    expect(silent.graph).toBe('[0:a]atrim=end_sample=88200[out]');
  });

  it('滤镜图从文件读，不放在命令行上：很密的包络照样只多一个文件名；选项按 ffmpeg 的说明挑', () => {
    const dense: Array<[number, number]> = Array.from({ length: 20_000 }, (_, i) => [0.5 + i * 0.00005, 0.5 + 0.5 * Math.sin(i / 7)]);
    const segment = { ...base.segments[0]!, gainDb: 0, envelope: dense };
    const { args, graph } = mixArgs({ ...base, segments: [segment] }, new Map([['a@1', asset]]), 48000, 2, '/tmp/out.wav', script);
    // 超过 macOS 整条命令行的上限（1 MiB）；参数里只有选项与文件名。
    expect(graph.length).toBeGreaterThan(1 << 20);
    expect(args.join(' ').length).toBeLessThan(1024);
    expect(args.slice(args.indexOf('-/filter_complex'), args.indexOf('-/filter_complex') + 2)).toEqual([
      '-/filter_complex',
      '/tmp/out.graph',
    ]);
    expect(args).not.toContain('-filter_complex');
    expect(filterScriptOption('-filter_complex_script <filename>  deprecated, use -/filter_complex instead')).toBe('-/filter_complex');
    expect(filterScriptOption('-filter_complex_script filename  read complex filtergraph description from a file')).toBe(
      '-filter_complex_script',
    );
  });

  /** 按 ffmpeg 表达式的语义求值（只用到 if/lt/clip/min/cos/sin/pow 与 PI）。 */
  function evaluate(expression: string, t: number): number {
    const body = expression.replaceAll('if(', 'iff(');
    const fn = new Function('t', 'iff', 'lt', 'clip', 'min', 'cos', 'sin', 'pow', 'PI', `return ${body};`) as (...a: unknown[]) => number;
    return fn(
      t,
      (c: number, y: number, n: number) => (c !== 0 ? y : n),
      (x: number, y: number) => (x < y ? 1 : 0),
      (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x)),
      Math.min,
      Math.cos,
      Math.sin,
      Math.pow,
      Math.PI,
    );
  }

  /** `render-graph` 的 `knots_at`，照抄来对照。 */
  function knotsAt(knots: Array<[number, number]>, t: number): number {
    let i = -1;
    knots.forEach(([at], j) => {
      if (at <= t) i = j;
    });
    if (i < 0) return 0;
    const next = knots[i + 1];
    if (next && next[0] > knots[i]![0]) return knots[i]![1] + ((next[1] - knots[i]![1]) * (t - knots[i]![0])) / (next[0] - knots[i]![0]);
    return knots[i]![1];
  }

  it('闪避的折点：分段线性、台阶取后一个、两端保持；与 render-graph 的 knots_at 一致', () => {
    const ducking: Array<[number, number]> = [
      [1, 0],
      [1.5, 6],
      [3, 6],
      [3, 2],
      [4, 2],
      [4.25, 0],
      [5, 0],
      [5, 9],
    ];
    const expression = duckingExpression({ start: 0.5, ducking })!;
    for (let n = 0; n <= 700; n++) {
      const t = n / 100;
      expect(evaluate(expression, t - 0.5)).toBeCloseTo(knotsAt(ducking, t), 9);
    }
    expect(duckingExpression({ start: 0, ducking: [] })).toBeNull();
    expect(
      duckingExpression({
        start: 0,
        ducking: [
          [0, 0],
          [1, 0],
        ],
      }),
    ).toBeNull();
  });

  it('逐样本的振幅：淡变 × 等功率交叉淡化 × 闪避', () => {
    const segment: AudioSegment = {
      ...base.segments[0]!,
      fadeIn: undefined,
      fadeOut: { start: 1.25, end: 1.5 },
      crossfades: [{ transitionId: 'tr', role: 'outgoing', start: 1, end: 2 }],
      ducking: [
        [0.5, 0],
        [0.75, 6],
      ],
    };
    const expression = gainExpression(segment)!;
    const expected = (t: number) => {
      const fade = Math.min(1, Math.max(0, (1.5 - t) / 0.25));
      const p = Math.min(1, Math.max(0, (t - 1) / 1));
      return fade * Math.cos((p * Math.PI) / 2) * 10 ** (-knotsAt(segment.ducking!, t) / 20);
    };
    for (const t of [0.5, 0.6, 0.75, 1, 1.2, 1.3, 1.49]) expect(evaluate(expression, t - 0.5)).toBeCloseTo(expected(t), 9);
    const incoming = gainExpression({
      ...segment,
      fadeOut: undefined,
      ducking: undefined,
      crossfades: [{ transitionId: 'tr', role: 'incoming', start: 0, end: 1 }],
    })!;
    expect(evaluate(incoming, 0)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(gainExpression({ ...segment, fadeOut: undefined, crossfades: [], ducking: undefined })).toBeNull();
  });

  /** `render-graph` 的 `envelope_at`（预览的 `GainEnvelope::at`），照抄来对照。 */
  function envelopeAt(knots: Array<[number, number]>, t: number): number {
    if (knots.length === 0) return 1;
    if (t <= knots[0]![0]) return knots[0]![1];
    const i = knots.findIndex(([at]) => at > t);
    if (i < 0) return knots[knots.length - 1]![1];
    const [t0, g0] = knots[i - 1]!;
    const [t1, g1] = knots[i]!;
    return t1 > t0 ? g0 + ((g1 - g0) * (t - t0)) / (t1 - t0) : g1;
  }

  it('音量包络：分段线性、两端保持、常量段不带插值项；与 render-graph 的 envelope_at 一致（v2 envelope_volume_expr）', () => {
    const envelope: Array<[number, number]> = [
      [1, 1],
      [2, 0.25],
      [4, 0.25],
      [4, 2],
      [5, 0.5],
    ];
    const expression = envelopeExpression({ start: 0.5, envelope })!;
    for (let n = 0; n <= 700; n++) {
      const t = n / 100;
      expect(evaluate(expression, t - 0.5)).toBeCloseTo(envelopeAt(envelope, t), 9);
    }
    // 第一个折点之前取它的值（不是 0）；0.25 的平台没有插值项。
    expect(evaluate(expression, 0)).toBe(1);
    expect(expression).toContain('if(lt(t,3.5),0.25,');
    expect(envelopeExpression({ start: 0, envelope: [[0, 0.5]] })).toBe('0.5');
    expect(
      envelopeExpression({
        start: 0,
        envelope: [
          [0, 0.7],
          [3, 0.7],
        ],
      }),
    ).toBe('0.7');
    expect(envelopeExpression({ start: 0, envelope: [] })).toBeNull();
    expect(envelopeExpression({ start: 0, envelope: [[0, 1]] })).toBeNull();
  });

  it('包络与淡变、闪避相乘；烘焙得很密的包络照样逐点对得上', () => {
    const segment: AudioSegment = {
      ...base.segments[0]!,
      gainDb: 0,
      envelope: [
        [0.5, 0.2],
        [1, 1],
      ],
      ducking: [
        [0.5, 0],
        [0.75, 6],
      ],
    };
    const expression = gainExpression(segment)!;
    for (const t of [0.5, 0.6, 0.75, 0.9, 1.2, 1.49]) {
      const fade = Math.min(1, Math.max(0, (t - 0.5) / 0.25));
      const expected = envelopeAt(segment.envelope!, t) * fade * 10 ** (-knotsAt(segment.ducking!, t) / 20);
      expect(evaluate(expression, t - 0.5)).toBeCloseTo(expected, 9);
    }
    // 60 秒的缓动按 0.02 秒烘焙：3001 个折点，二分只比较 12 次。
    const dense: Array<[number, number]> = Array.from({ length: 3001 }, (_, i) => [i * 0.02, 1 - (i / 3000) ** 2]);
    const long = envelopeExpression({ start: 0, envelope: dense })!;
    for (const t of [0, 0.013, 17.5, 30.01, 59.99, 61]) expect(evaluate(long, t)).toBeCloseTo(envelopeAt(dense, t), 6);
    expect(long.match(/if\(/g)!.length).toBe(3001);
  });
});

describe('落点与发布', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-publish-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('文件名：去掉不能用的字符、补扩展名、重名加序号', () => {
    expect(safeFileStem('a/b:c*?')).toBe('a_b_c__');
    expect(safeFileStem('...')).toBe('video');
    expect(withExtension('成品', 'srt')).toBe('成品.srt');
    expect(withExtension('成品.SRT', 'srt')).toBe('成品.SRT');
    expect(candidateName('a.en.srt', 1)).toBe('a.en.srt');
    expect(candidateName('a.en.srt', 3)).toBe('a.en (3).srt');
  });

  it('目录：给定的必须存在且是绝对路径；默认的按需建', async () => {
    await expect(prepareDirectory('relative', false)).rejects.toBeInstanceOf(DestinationError);
    await expect(prepareDirectory(path.join(dir, 'missing'), false)).rejects.toMatchObject({ code: 'EXPORT_DESTINATION_UNWRITABLE' });
    expect(await prepareDirectory(path.join(dir, 'exports'), true)).toBe(path.join(dir, 'exports'));
    expect((await fs.stat(path.join(dir, 'exports'))).isDirectory()).toBe(true);
  });

  it('发布：不覆盖，重名加序号；指定的名字已存在时拒绝，除非覆盖；不留临时文件', async () => {
    const staged = path.join(dir, 'staged.srt');
    await fs.writeFile(staged, 'new');
    const out = path.join(dir, 'out');
    await fs.mkdir(out);
    await fs.writeFile(path.join(out, 'a.srt'), 'old');

    expect(await publishFile(staged, out, 'a.srt', { overwrite: false, fixed: false })).toBe(path.join(out, 'a (2).srt'));
    expect(await fs.readFile(path.join(out, 'a.srt'), 'utf8')).toBe('old');
    await expect(checkFixedName(out, 'a.srt', false)).rejects.toMatchObject({ code: 'EXPORT_DESTINATION_EXISTS' });
    await expect(publishFile(staged, out, 'a.srt', { overwrite: false, fixed: true })).rejects.toMatchObject({
      code: 'EXPORT_DESTINATION_EXISTS',
    });
    expect(await publishFile(staged, out, 'a.srt', { overwrite: true, fixed: true })).toBe(path.join(out, 'a.srt'));
    expect(await fs.readFile(path.join(out, 'a.srt'), 'utf8')).toBe('new');
    expect((await fs.readdir(out)).sort()).toEqual(['a (2).srt', 'a.srt']);
    // staging 里的文件还在（之后登记为产物）。
    expect(await fs.readFile(staged, 'utf8')).toBe('new');
  });
});
