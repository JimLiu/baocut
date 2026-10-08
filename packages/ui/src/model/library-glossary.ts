import { defineMessages, live, type GlossaryContent, type TranscriptionGlossary, type TranslationGlossary } from '@baocut/protocol';
import { languageName } from './caption-tracks.ts';
import { zhHans } from './library-glossary.zh-Hans.ts';
import { zhHant } from './library-glossary.zh-Hant.ts';
import { ja } from './library-glossary.ja.ts';
import { ko } from './library-glossary.ko.ts';
import { es } from './library-glossary.es.ts';
import { fr } from './library-glossary.fr.ts';
import { de } from './library-glossary.de.ts';
import { nl } from './library-glossary.nl.ts';
import { ptBR } from './library-glossary.pt-BR.ts';
import { it } from './library-glossary.it.ts';
import { ru } from './library-glossary.ru.ts';
import { pl } from './library-glossary.pl.ts';
import { tr } from './library-glossary.tr.ts';
import { vi } from './library-glossary.vi.ts';

const chars = (n: number) => (n === 1 ? '1 character' : `${n} characters`);
const terms = (n: number) => (n === 1 ? '1 term' : `${n} terms`);

/** 术语库模型的文案（英文是键与类型的来源，译文在 `library-glossary.zh-Hans.ts`）。 */
const en = {
  kinds: {
    transcription: { label: 'Transcription glossary', a: 'Correct spelling', b: 'Often misheard as' },
    translation: { label: 'Translation glossary', a: 'Source', b: 'Translation' },
  } as Record<'transcription' | 'translation', { label: string; a: string; b: string }>,
  anyLanguage: 'Any language',
  spoken: (language: string) => `${language} speech`,
  newTranscription: 'New transcription glossary',
  fieldCanonical: 'Correct spelling',
  fieldSource: 'Source',
  fieldTarget: 'Translation',
  fieldEmpty: (label: string) => `${label} can’t be empty`,
  fieldTooLong: (label: string, max: number) => `${label} can’t be longer than ${chars(max)}`,
  fieldNewline: (label: string) => `${label} can’t contain line breaks`,
  duplicate: (term: string) => `“${term}” is already in the glossary`,
  misheardSame: 'A misheard spelling can’t be the same as the correct spelling',
  misheardTooMany: (max: number) => `Up to ${max} misheard spellings`,
  misheardTooLong: (max: number) => `Each spelling can’t be longer than ${chars(max)}`,
  noteTooLong: (max: number) => `The note can’t be longer than ${chars(max)}`,
  nameEmpty: 'The glossary name can’t be empty',
  nameTooLong: (max: number) => `The glossary name can’t be longer than ${chars(max)}`,
  skipPunctuation: 'Only punctuation',
  skipTooLong: (max: number) => `Longer than ${chars(max)}`,
  skipMerged: 'Same term as an earlier line; merged',
  skipNoTarget: 'No translation',
  skipKeptFirst: 'Same term as an earlier line; kept the first one',
  allExist: 'These terms are already in the glossary',
  added: (n: number) => `Added ${terms(n)}`,
  merged: (n: number) => `${terms(n)} already in the glossary`,
  overflow: (n: number, limit: number) => `${terms(n)} not added: a glossary can hold up to ${limit} terms`,
  fileName: 'Glossary',
  /** 一格里几种误写之间的分隔（`splitMisheard` 认得这几种）；不用带「和 / and」的列表格式，免得读回来多出一个词。 */
  misheardSeparator: ', ',
};
export type LibraryGlossaryMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 设置 › 术语库的纯模型（产品设计 §15.10，设计稿 designs/baocut/app/model-glossary.js）。库里两种表各管一件事：
 * 转录术语表是「规范写法 ← 常听错成」，翻译术语表是「原文 → 译文」并带语言方向。
 * 写入规则以 Runtime 为准（`@baocut/runtime-storage` 的 `normalizeGlossary`）：首尾空白去掉、不能为空、不能换行、
 * 一条不超过 200 字、一张表不超过 5000 条、一条最多 50 个误写、同一个规范写法（原文）只能出现一次。
 * 这里先把这些挡在界面上，免得用户填完了才在保存时被拒。
 */

export type GlossaryKind = GlossaryContent['kind'];
export type TranscriptionTerm = TranscriptionGlossary['terms'][number];
export type TranslationTerm = TranslationGlossary['terms'][number];

export const GLOSSARY_LIMITS = { name: 200, term: 200, terms: 5000, misheard: 50, note: 1000 } as const;

/** 两种表的叫法与两格的名字（model-glossary.js `KINDS`）。 */
export const GLOSSARY_KINDS: Record<GlossaryKind, { label: string; a: string; b: string }> = live(() => M.kinds);

/**
 * 归并键：小写、去空白、去 ASCII 标点（与设计稿 `normKey` 同口径）。`KV cache` / `kv-cache` / `KV Cache`
 * 是同一个词，往表里加的时候并成一条，而不是并存成三条。
 */
export function normKey(text: string | null | undefined): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[!-/:-@[-`{-~]+/g, '');
}

const sameTerm = (a: string, b: string) => normKey(a) !== '' && normKey(a) === normKey(b);

/** 一格里的几种误写：逗号、顿号、分号都算分隔；去掉空的与重复的。 */
export function splitMisheard(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，、;；]/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

export function joinMisheard(list: readonly string[]): string {
  return list.join(M.misheardSeparator);
}

// ---- 语言 ----

/** 语言下拉里常备的几门（与「AI 工具」的语言表同一份）；表里已经用着的别的语言另外补上。 */
export const COMMON_LANGUAGES: readonly string[] = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ar'];

/** BCP 47 的规范写法；不合法时 null（Runtime 用同一个 `Intl.getCanonicalLocales` 判）。 */
export function canonicalLanguage(tag: string): string | null {
  const text = tag.trim();
  if (!text) return null;
  try {
    return Intl.getCanonicalLocales(text)[0] ?? null;
  } catch {
    return null;
  }
}

/** 语言的名字（这门语言自己的叫法）；不限时「任意语言」。 */
export function languageLabel(tag: string | null): string {
  return tag ? languageName(tag) : M.anyLanguage;
}

/** 下拉里列出的语言：常备的几门，加上当前值里不在其中的。 */
export function languageOptions(current: readonly (string | null)[]): string[] {
  const out = [...COMMON_LANGUAGES];
  for (const tag of current) if (tag && !out.includes(tag)) out.push(tag);
  return out;
}

/** 表名旁边那句方向：`English → 中文`、`中文 口播`、`任意语言`。 */
export function pairLabel(content: GlossaryContent): string {
  if (content.kind === 'translation') return `${languageLabel(content.sourceLanguage)} → ${languageLabel(content.targetLanguage)}`;
  return content.language ? M.spoken(languageLabel(content.language)) : M.anyLanguage;
}

// ---- 新建 ----

export function newTranscriptionGlossary(name: string = M.newTranscription): TranscriptionGlossary {
  return { name, kind: 'transcription', language: null, defaultEnabled: true, terms: [] };
}

/** 新建翻译表先定方向：方向是这张表的身份（设计稿 `NewTrans`），名字默认就是方向。 */
export function newTranslationGlossary(sourceLanguage: string | null, targetLanguage: string): TranslationGlossary {
  return {
    name: `${languageLabel(sourceLanguage)} → ${languageLabel(targetLanguage)}`,
    kind: 'translation',
    sourceLanguage,
    targetLanguage,
    defaultEnabled: true,
    terms: [],
  };
}

/** 源语言与目标语言是同一门（按主语种比）：这样的翻译表没有意义。 */
export function sameLanguage(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase().split(/[-_]/)[0] === b.toLowerCase().split(/[-_]/)[0];
}

// ---- 校验 ----

function textProblems(value: string, label: string, max: number): string[] {
  const text = value.trim();
  if (!text) return [M.fieldEmpty(label)];
  const out: string[] = [];
  if ([...text].length > max) out.push(M.fieldTooLong(label, max));
  if (/[\r\n]/.test(text)) out.push(M.fieldNewline(label));
  return out;
}

/**
 * 一条转录术语的问题（空数组 = 可以保存）。`others` 是表里别的条目：同一个词（按归并键）不能出现两次。
 * 误写可以不填——只想让识别模型认得这个写法。
 */
export function transcriptionTermProblems(term: TranscriptionTerm, others: readonly TranscriptionTerm[]): string[] {
  const out = textProblems(term.canonical, M.fieldCanonical, GLOSSARY_LIMITS.term);
  const canonical = term.canonical.trim();
  const twin = canonical ? others.find((t) => sameTerm(t.canonical, canonical)) : undefined;
  if (twin) out.push(M.duplicate(twin.canonical));
  const misheard = term.misheard.map((m) => m.trim()).filter(Boolean);
  if (misheard.some((m) => sameTerm(m, canonical))) out.push(M.misheardSame);
  if (misheard.length > GLOSSARY_LIMITS.misheard) out.push(M.misheardTooMany(GLOSSARY_LIMITS.misheard));
  if (misheard.some((m) => [...m].length > GLOSSARY_LIMITS.term)) out.push(M.misheardTooLong(GLOSSARY_LIMITS.term));
  return out;
}

/** 一条翻译术语的问题：原文与译文都必填（没有译文的条目什么也不约束），备注可空。 */
export function translationTermProblems(term: TranslationTerm, others: readonly TranslationTerm[]): string[] {
  const out = [...textProblems(term.source, M.fieldSource, GLOSSARY_LIMITS.term), ...textProblems(term.target, M.fieldTarget, GLOSSARY_LIMITS.term)];
  const source = term.source.trim();
  const twin = source ? others.find((t) => sameTerm(t.source, source)) : undefined;
  if (twin) out.push(M.duplicate(twin.source));
  if ([...(term.note ?? '').trim()].length > GLOSSARY_LIMITS.note) out.push(M.noteTooLong(GLOSSARY_LIMITS.note));
  return out;
}

/** 表名的问题。 */
export function glossaryNameProblem(name: string): string | null {
  const text = name.trim();
  if (!text) return M.nameEmpty;
  if ([...text].length > GLOSSARY_LIMITS.name) return M.nameTooLong(GLOSSARY_LIMITS.name);
  return null;
}

/** 整理成要交给 `library.put` 的样子：去掉首尾空白，误写去重并去掉与规范写法相同的，空备注写 null。 */
export function tidyTranscriptionTerm(term: TranscriptionTerm): TranscriptionTerm {
  const canonical = term.canonical.trim();
  const misheard = [...new Set(term.misheard.map((m) => m.trim()).filter(Boolean))].filter((m) => m !== canonical);
  return { canonical, misheard };
}

export function tidyTranslationTerm(term: TranslationTerm): TranslationTerm {
  const note = (term.note ?? '').trim();
  return { source: term.source.trim(), target: term.target.trim(), note: note || null };
}

// ---- 一次粘一批 ----

export interface SkippedLine {
  line: string;
  why: string;
}

interface Columns {
  b?: number;
  note?: number;
}

/**
 * 把粘进来的一批行拆成单元格（设计稿 `parseLines`）。一行一条：`=`、`=>`、`->`、`→`、Tab 都算分隔；
 * Markdown 表与从表格软件复制的 Tab 分隔走同一只解析，Markdown 表按表头认列。标题、front matter、分隔行跳过。
 */
function rowsOf(text: string, kind: GlossaryKind): { line: string; cells: string[]; cols: Columns | null }[] {
  const rows: { line: string; cells: string[]; cols: Columns | null }[] = [];
  let header: Columns | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^-{3,}$/.test(line)) continue;
    if (/^[A-Za-z]+\s*:\s/.test(line) && !/[=→\t|]/.test(line)) continue;
    if (line.startsWith('|')) {
      const cells = line
        .replace(/^\|/, '')
        .replace(/(?<!\\)\|$/, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.replace(/\\\|/g, '|').replace(/\\\\/g, '\\').trim());
      if (cells.every((cell) => /^:?-+:?$/.test(cell) || cell === '')) continue;
      if (/^(source|term|原文|规范写法)$/i.test(cells[0] ?? '')) {
        header = {};
        cells.forEach((cell, index) => {
          const key = cell.toLowerCase();
          if (/^(misheard|variants|常听错成|常见误识|target|译文|译名)$/.test(key)) header!.b = index;
          else if (/^(note|备注)$/.test(key)) header!.note = index;
        });
        continue;
      }
      rows.push({ line, cells, cols: header });
      continue;
    }
    header = null;
    const parts = line.split(/\s*(?:=>|->|→|=|\t)\s*/);
    const cells = parts.length > 1 ? parts : kind === 'translation' ? line.split(/\s*[,，]\s*/) : [line];
    rows.push({ line, cells, cols: null });
  }
  return rows;
}

function termTooLong(...values: string[]): boolean {
  return values.some((value) => [...value].length > GLOSSARY_LIMITS.term);
}

/** 转录表：`KV cache = 开维缓存、KV 换成`，只写规范写法也行。同一批里重复的词并成一条，误写取并集。 */
export function parseTranscriptionLines(text: string): { terms: TranscriptionTerm[]; skipped: SkippedLine[] } {
  const terms: TranscriptionTerm[] = [];
  const skipped: SkippedLine[] = [];
  const seen = new Map<string, TranscriptionTerm>();
  for (const { line, cells, cols } of rowsOf(text, 'transcription')) {
    const canonical = (cells[0] ?? '').trim();
    const key = normKey(canonical);
    if (!key) {
      skipped.push({ line, why: M.skipPunctuation });
      continue;
    }
    const misheard = splitMisheard(cells[cols?.b ?? 1] ?? '').filter((m) => !sameTerm(m, canonical));
    if (termTooLong(canonical, ...misheard)) {
      skipped.push({ line, why: M.skipTooLong(GLOSSARY_LIMITS.term) });
      continue;
    }
    const prev = seen.get(key);
    if (prev) {
      prev.misheard = [...new Set([...prev.misheard, ...misheard])].slice(0, GLOSSARY_LIMITS.misheard);
      skipped.push({ line, why: M.skipMerged });
      continue;
    }
    const term = { canonical, misheard: misheard.slice(0, GLOSSARY_LIMITS.misheard) };
    seen.set(key, term);
    terms.push(term);
  }
  return { terms, skipped };
}

/** 翻译表：`commit = 突破确认`，第三格是备注。没有译文的行退回来并说明原因，不悄悄丢。 */
export function parseTranslationLines(text: string): { terms: TranslationTerm[]; skipped: SkippedLine[] } {
  const terms: TranslationTerm[] = [];
  const skipped: SkippedLine[] = [];
  const seen = new Set<string>();
  for (const { line, cells, cols } of rowsOf(text, 'translation')) {
    const source = (cells[0] ?? '').trim();
    const key = normKey(source);
    if (!key) {
      skipped.push({ line, why: M.skipPunctuation });
      continue;
    }
    const target = (cells[cols?.b ?? 1] ?? '').trim();
    if (!target) {
      skipped.push({ line, why: M.skipNoTarget });
      continue;
    }
    if (termTooLong(source, target)) {
      skipped.push({ line, why: M.skipTooLong(GLOSSARY_LIMITS.term) });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({ line, why: M.skipKeptFirst });
      continue;
    }
    seen.add(key);
    const note = (cells[cols?.note ?? 2] ?? '').trim().slice(0, GLOSSARY_LIMITS.note);
    terms.push({ source, target, note: note || null });
  }
  return { terms, skipped };
}

// ---- 加词 ----

export interface AddResult<T> {
  terms: T[];
  added: number;
  merged: number;
  /** 超过一张表的上限、没加进去的条数。 */
  overflow: number;
}

/** 把一批新词并进转录表：已有的词（按归并键）不重复加，只并入新的误写。 */
export function addTranscriptionTerms(terms: readonly TranscriptionTerm[], incoming: readonly TranscriptionTerm[]): AddResult<TranscriptionTerm> {
  const out = terms.map((t) => ({ ...t, misheard: [...t.misheard] }));
  let added = 0;
  let merged = 0;
  let overflow = 0;
  for (const term of incoming) {
    const at = out.findIndex((t) => sameTerm(t.canonical, term.canonical));
    if (at >= 0) {
      const existing = out[at]!;
      existing.misheard = [...new Set([...existing.misheard, ...term.misheard])]
        .filter((m) => m !== existing.canonical)
        .slice(0, GLOSSARY_LIMITS.misheard);
      merged += 1;
    } else if (out.length >= GLOSSARY_LIMITS.terms) {
      overflow += 1;
    } else {
      out.push(tidyTranscriptionTerm(term));
      added += 1;
    }
  }
  return { terms: out, added, merged, overflow };
}

/** 把一批新词并进翻译表：已有的词保留原来的译法（改译法到那一条上改）。 */
export function addTranslationTerms(terms: readonly TranslationTerm[], incoming: readonly TranslationTerm[]): AddResult<TranslationTerm> {
  const out = terms.map((t) => ({ ...t }));
  let added = 0;
  let merged = 0;
  let overflow = 0;
  for (const term of incoming) {
    if (out.some((t) => sameTerm(t.source, term.source))) merged += 1;
    else if (out.length >= GLOSSARY_LIMITS.terms) overflow += 1;
    else {
      out.push(tidyTranslationTerm(term));
      added += 1;
    }
  }
  return { terms: out, added, merged, overflow };
}

/** 加词之后的回执。 */
export function addedText(result: Pick<AddResult<unknown>, 'added' | 'merged' | 'overflow'>): string {
  if (!result.added && !result.overflow) return M.allExist;
  const parts = [M.added(result.added)];
  if (result.merged) parts.push(M.merged(result.merged));
  if (result.overflow) parts.push(M.overflow(result.overflow, GLOSSARY_LIMITS.terms));
  return parts.join(' · ');
}

// ---- 搜索与反向 ----

/** 搜规范写法、误写（转录表）或原文、译文、备注（翻译表）；返回命中的条目在表里的位置。 */
export function searchTerms(content: GlossaryContent, query: string): number[] {
  const key = normKey(query);
  const all = content.terms.map((_, index) => index);
  if (!key) return all;
  const hit = (value: string | null) => normKey(value).includes(key);
  if (content.kind === 'transcription') {
    return all.filter((i) => hit(content.terms[i]!.canonical) || content.terms[i]!.misheard.some(hit));
  }
  return all.filter((i) => hit(content.terms[i]!.source) || hit(content.terms[i]!.target) || hit(content.terms[i]!.note));
}

/**
 * 掉头生成反方向的翻译表（设计稿 `reversePack`）：原文与译文对调，译文相同的只留第一条。
 * 原表的源语言不限时生成不了——反向表的目标语言必须确定。新表默认不给新视频启用。
 */
export function reverseTranslation(content: TranslationGlossary): TranslationGlossary | null {
  if (!content.sourceLanguage) return null;
  const seen = new Set<string>();
  const terms: TranslationTerm[] = [];
  for (const term of content.terms) {
    const key = normKey(term.target);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    terms.push({ source: term.target, target: term.source, note: term.note });
  }
  return {
    name: `${languageLabel(content.targetLanguage)} → ${languageLabel(content.sourceLanguage)}`,
    kind: 'translation',
    sourceLanguage: content.targetLanguage,
    targetLanguage: content.sourceLanguage,
    defaultEnabled: false,
    terms,
  };
}

/** 导出时建议的文件名：表名去掉文件名里不能有的字符。 */
export function exportFileName(name: string): string {
  const safe = name.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ').trim();
  return `${safe || M.fileName}.md`;
}
