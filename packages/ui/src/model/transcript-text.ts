import { defineMessages, transcriptMarkdownText, transcriptOneLine, transcriptStamp } from '@baocut/protocol';
import type { TextRange } from './text-find.ts';
import { editWordText, rawWordId, type TranscriptWord } from './transcript-cut.ts';
import { readTranslation, speechSentences, unitText } from './translation-doc.ts';
import { zhHans } from './transcript-text.zh-Hans.ts';
import { zhHant } from './transcript-text.zh-Hant.ts';
import { ja } from './transcript-text.ja.ts';
import { ko } from './transcript-text.ko.ts';
import { es } from './transcript-text.es.ts';
import { fr } from './transcript-text.fr.ts';
import { de } from './transcript-text.de.ts';
import { nl } from './transcript-text.nl.ts';
import { ptBR } from './transcript-text.pt-BR.ts';
import { it } from './transcript-text.it.ts';
import { ru } from './transcript-text.ru.ts';
import { pl } from './transcript-text.pl.ts';
import { tr } from './transcript-text.tr.ts';
import { vi } from './transcript-text.vi.ts';

/**
 * 文稿的纯文本：复制、查找替换与译文视图都从这里取（设计稿 model-transcript.js `paraText` / `copyText` / `copyReceipt`，
 * panels.jsx `TranscriptPanel` 的查找）。
 *
 * - 一段的文字照屏幕上拼：词去掉首尾空白，`spaced` 的词前面空一格。整个剪掉的词不算（与导出、改字态同一口径）。
 * - 替换落在转写正文的词上（`editWordText`，不动时间线）：命中只在一个词里时改这个词；跨了几个词时，替换后的文字按空白
 *   拆开的块数与原来的词数一样就一一对上，否则整体落到第一个词、其余的词隐藏。命中盖住了词间的空格时两边的词一起算。
 * - 译文按句对应到段：一句归它第一个词所在的那一段，段里各句的译文按次序接起来。
 */

/** 复制回执（译文在 `transcript-text.<语言>.ts`）。 */
const en = {
  receipt: (paragraphs: number, amount: string) => `${paragraphs} ${paragraphs === 1 ? 'paragraph' : 'paragraphs'} · ${amount}`,
  characters: (n: number) => `${n} ${n === 1 ? 'character' : 'characters'}`,
  words: (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`,
};
export type TranscriptTextMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

type Json = Record<string, unknown>;

/** 复制与引用用的时间码：与导出的文稿同一个写法（`mm:ss`，向下取整；一小时以上 `hh:mm:ss`）。 */
export const timeStamp = transcriptStamp;

// ---- 一段的文字 ----

/** 一个词在段落文字里的位置（左闭右开）。 */
export interface WordSpan extends TextRange {
  id: string;
  index: number;
}

export interface ParagraphText {
  text: string;
  words: WordSpan[];
}

type TextWord = Pick<TranscriptWord, 'id' | 'index' | 'text' | 'spaced' | 'state'>;

/** 一段（或一串选中的词）的文字。`withCut` 时剪掉的词也算（选区复制：选了什么就复制什么）。 */
export function paragraphText(words: readonly TextWord[], withCut = false): ParagraphText {
  let text = '';
  const spans: WordSpan[] = [];
  for (const word of words) {
    if (!withCut && word.state === 'cut') continue;
    const value = word.text.trim();
    if (!value) continue;
    if (spans.length && word.spaced) text += ' ';
    spans.push({ id: word.id, index: word.index, start: text.length, end: text.length + value.length });
    text += value;
  }
  return { text, words: spans };
}

/** 查找命中落在一个词身上的样子：词内的几段（相对这个词的偏移），与它前面那个空格要不要一起标（0 不标，1 标，2 当前那一处）。 */
export interface WordHighlight {
  ranges: Array<{ start: number; end: number; current: boolean }>;
  gap: 0 | 1 | 2;
}

/** 一段里的命中（`para.text` 上的区间）摊到词上，按词下标（`TranscriptWord.index`）给。 */
export function wordHighlights(para: ParagraphText, marks: readonly (TextRange & { current?: boolean })[]): Map<number, WordHighlight> {
  const out = new Map<number, WordHighlight>();
  const of = (index: number) => {
    let found = out.get(index);
    if (!found) out.set(index, (found = { ranges: [], gap: 0 }));
    return found;
  };
  for (const mark of marks) {
    let prevEnd: number | null = null;
    for (const word of para.words) {
      if (prevEnd !== null && word.start > prevEnd && mark.start < word.start && mark.end > prevEnd) {
        const found = of(word.index);
        found.gap = mark.current ? 2 : found.gap === 2 ? 2 : 1;
      }
      const start = Math.max(mark.start, word.start);
      const end = Math.min(mark.end, word.end);
      if (start < end) of(word.index).ranges.push({ start: start - word.start, end: end - word.start, current: !!mark.current });
      prevEnd = word.end;
    }
  }
  return out;
}

// ---- 替换 ----

/** 一处命中碰到的词（在 `para.words` 里的下标，升序）：字有重叠的词，加上被它盖住的词间空格两边的词。 */
function touched(para: ParagraphText, range: TextRange): number[] {
  const hit = new Set<number>();
  para.words.forEach((word, k) => {
    if (word.start < range.end && word.end > range.start) hit.add(k);
    const prev = para.words[k - 1];
    if (prev && prev.end < word.start && range.start <= prev.end && range.end >= word.start) {
      hit.add(k - 1);
      hit.add(k);
    }
  });
  return [...hit].sort((a, b) => a - b);
}

/**
 * 在一段里落下若干替换（命中来自 `findRanges(para.text, …)`，互不重叠），改写转写正文里对应的词。返回新正文与实际改了几处；
 * 什么都没变时 null。替换文字按字面插入。
 */
export function replaceInParagraph(
  body: unknown,
  para: ParagraphText,
  ranges: readonly TextRange[],
  replacement: string,
): { body: Json; changed: number } | null {
  // 碰到的词连成块：同一个词上的几处、连着的几处并成一块，一块一起改。
  const clusters: Array<{ from: number; to: number; ranges: TextRange[] }> = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const words = touched(para, range);
    if (!words.length) continue;
    const from = words[0]!;
    const to = words.at(-1)!;
    const last = clusters.at(-1);
    if (last && from <= last.to) {
      last.to = Math.max(last.to, to);
      last.ranges.push(range);
    } else clusters.push({ from, to, ranges: [range] });
  }
  const next = new Map<number, string>();
  let changed = 0;
  for (const cluster of clusters) {
    const first = para.words[cluster.from]!;
    const end = para.words[cluster.to]!.end;
    const before = para.text.slice(first.start, end);
    let after = before;
    for (const range of [...cluster.ranges].sort((a, b) => b.start - a.start)) {
      const start = Math.max(range.start, first.start) - first.start;
      const stop = Math.min(range.end, end) - first.start;
      if (after.slice(start, stop) !== replacement) changed++;
      after = after.slice(0, start) + replacement + after.slice(stop);
    }
    const count = cluster.to - cluster.from + 1;
    const tokens = after.trim() ? after.trim().split(/\s+/) : [];
    if (count === 1) next.set(cluster.from, after);
    else if (before.split(/\s+/).length === count && tokens.length === count) tokens.forEach((token, n) => next.set(cluster.from + n, token));
    else for (let k = cluster.from; k <= cluster.to; k++) next.set(k, k === cluster.from ? after : '');
  }
  let doc: Json | null = null;
  for (const k of [...next.keys()].sort((a, b) => b - a)) {
    const word = para.words[k]!;
    if (next.get(k) === para.text.slice(word.start, word.end)) continue;
    doc = editWordText(doc ?? body, word.id, next.get(k)!) ?? doc;
  }
  return doc && changed ? { body: doc, changed } : null;
}

// ---- 复制 ----

/** 文稿的语言视图：原文、只看译文、双语对照（原文一行、译文一行）。 */
export type TranscriptView = 'source' | 'translation' | 'both';

export interface CopyParagraph {
  /** 段首在序列上的时刻（秒）。 */
  start: number;
  speaker: string | null;
  text: string;
  translation: string;
}

/** 一段在某个视图下的文字；双语是两行，不拼成一句。 */
export function viewText(para: Pick<CopyParagraph, 'text' | 'translation'>, view: TranscriptView): string {
  if (view === 'translation') return para.translation;
  if (view === 'both') return [para.text, para.translation].filter(Boolean).join('\n');
  return para.text;
}

/** 只要文字（「只复制文字」与选区的复制）：段与段之间空一行，不带说话人与时间。 */
export function copyText(paras: readonly CopyParagraph[], options: { view: TranscriptView }): string {
  return paras.map((para) => viewText(para, options.view)).join('\n\n');
}

/** 文稿的一节：章节（第一章之前、不写章节时 null）与归它的段。 */
export interface CopySection {
  chapter: { title: string; start: number } | null;
  paras: readonly CopyParagraph[];
}

export interface TranscriptWriteOptions {
  format: 'md' | 'txt';
  view: TranscriptView;
  speakers: boolean;
  timestamps: boolean;
  /** Markdown 开头的一级标题（视频名）；节选（这一段、这一章）不写。 */
  title?: string | null;
}

/**
 * 按导出文稿的写法排出几节段落（命令与协议规范 §4.4，与 Runtime text-export.ts 的 `writeMarkdown` / `writeText` 逐行对应）：
 * 复制这一段、这一章，以及只看译文时的全文——这几种 Runtime 排不了（范围导出的时间从范围起点算、Markdown 总带标题；
 * 主文档不收译文）。其余的全文复制走 `exports.renderText`，与导出的文件逐字节相同。
 *
 * - Markdown：章节 `## 名字`（带时间戳时 ` · mm:ss`），段 `**说话人:** 正文 [mm:ss]`，双语的译文另起一块 `> 译文`；标记字符转义。
 * - 纯文本：章节 `— 名字 —`，段 `说话人: 正文 [mm:ss]`，双语的译文紧接下一行。
 * - 只看译文时译文当正文写；正文是空的段不写，没有段落的章不写。块与块之间空一行，末尾不加换行。
 */
export function writeTranscript(sections: readonly CopySection[], options: TranscriptWriteOptions): string {
  const md = options.format === 'md';
  const stamp = (seconds: number) => (options.timestamps ? transcriptStamp(seconds) : null);
  const out: string[] = [];
  if (md && options.title) out.push(`# ${transcriptMarkdownText(options.title)}`);
  for (const section of sections) {
    const paras = section.paras.filter((p) => (options.view === 'translation' ? p.translation : p.text).trim());
    if (!paras.length) continue;
    const chapter = section.chapter;
    if (chapter) {
      const at = stamp(chapter.start);
      out.push(md ? `## ${transcriptMarkdownText(transcriptOneLine(chapter.title))}${at ? ` · ${at}` : ''}` : `— ${transcriptOneLine(chapter.title)} —`);
    }
    for (const p of paras) {
      const text = options.view === 'translation' ? p.translation : p.text;
      const translation = options.view === 'both' ? p.translation : '';
      const at = stamp(p.start);
      const end = at ? ` [${at}]` : '';
      const speaker = options.speakers ? p.speaker : null;
      if (md) {
        out.push(`${speaker ? `**${transcriptMarkdownText(speaker)}:** ` : ''}${transcriptMarkdownText(text)}${end}`);
        if (translation) out.push(`> ${transcriptMarkdownText(translation)}`);
      } else {
        const head = `${speaker ? `${speaker}: ` : ''}${text}${end}`;
        out.push(translation ? `${head}\n${translation}` : head);
      }
    }
  }
  return out.join('\n\n');
}

/** 按章节分节：一段归它开始时已经开始的最后一章（与导出同一个归法）。`chapters` 按开始排好。 */
export function chapterSections(paras: readonly CopyParagraph[], chapters: readonly { title: string; start: number }[]): CopySection[] {
  const out: { chapter: CopySection['chapter']; paras: CopyParagraph[] }[] = [];
  let current = -1;
  for (const para of paras) {
    const index = chapters.findLastIndex((c) => c.start <= para.start + 1e-6);
    const heading = index >= 0 && index !== current;
    if (index >= 0) current = index;
    const last = out.at(-1);
    if (last && !heading) last.paras.push(para);
    else out.push({ chapter: heading ? chapters[index]! : null, paras: [para] });
  }
  return out;
}

/** 复制的回执：段数加字数——中文按字、拉丁文字按词（两种语言的「量」不是一回事），哪种多按哪种算。 */
export function copyReceipt(paras: readonly Pick<CopyParagraph, 'text' | 'translation'>[], view: TranscriptView): string {
  const text = paras.map((para) => viewText(para, view)).join('');
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const words = (text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length;
  return lengthReceipt(paras.length, cjk, words);
}

/** 「N 段 · M 字」：汉字比拉丁词多时按字数说，否则按词数说（导出面板的篇幅用 Runtime 数好的字数与词数）。 */
export function lengthReceipt(paragraphs: number, cjkCharacters: number, words: number): string {
  return M.receipt(paragraphs, cjkCharacters >= words ? M.characters(cjkCharacters) : M.words(words));
}

// ---- 译文 ----

const CJK_END = /[　-〿぀-ヿ㐀-鿿＀-￯]$/u;

/**
 * 每段的译文（与 `paragraphs` 一一对应，没有译文的段是空串）。句子取自转写正文（没存句子时按停顿与句末标点派生，
 * 与翻译时同一个取法），一句归它第一个还在文稿里的词所在的段。正文认不出时 null。
 */
export function paragraphTranslations(
  speechBody: unknown,
  translationBody: unknown,
  paragraphs: readonly { words: readonly { id: string }[] }[],
): string[] | null {
  const sentences = speechSentences(speechBody);
  const translation = readTranslation(translationBody);
  if (!sentences || !translation) return null;
  const owner = new Map<string, number>();
  paragraphs.forEach((para, n) => {
    for (const word of para.words) if (!owner.has(rawWordId(word.id))) owner.set(rawWordId(word.id), n);
  });
  const units = new Map(translation.units.map((unit) => [unit.sourceSentenceId, unit]));
  const out = paragraphs.map(() => '');
  for (const sentence of sentences) {
    const unit = units.get(sentence.id);
    const text = unit ? unitText(unit) : '';
    if (!text) continue;
    const at = sentence.wordIds.map((id) => owner.get(id)).find((n) => n !== undefined);
    if (at === undefined) continue;
    const prev = out[at]!;
    out[at] = !prev ? text : CJK_END.test(prev) ? prev + text : `${prev} ${text}`;
  }
  return out;
}
