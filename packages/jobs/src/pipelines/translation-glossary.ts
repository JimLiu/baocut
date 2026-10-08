import {
  RpcError,
  type FrozenLibraryEntry,
  type GlossaryEntry,
  type Id,
  type JobSubmitter,
  type TranslateGlossaryUse,
  type TranslationGlossary,
} from '@baocut/protocol';
import type { LibraryStore } from '@baocut/runtime-storage/library';
import { JobsTranslationGlossary as J } from '@baocut/protocol/messages/jobs/translation-glossary.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';

/**
 * 翻译用的术语表（架构设计 §7.9；视频格式规范 §5.3 的 `glossaryRef`）：
 *
 * - 来源依次是调用时给的术语（`glossary`）、调用时给的库里的术语表（`glossaries`）、视频里启用的翻译用术语表；
 *   同一个原文写法只取最先出现的那条。启动时冻结库里条目的版本，内容在第一步之前就写进产物，之后不再读库。
 * - 进提示词有上限：去重之后不超过 `ALL_TERMS` 条（且放得下）时全部带上；否则每批只带原文写法出现在这一批
 *   （或它的前文）里的，再按上面的顺序截到 `MAX_TERMS` 条、`MAX_CHARS` 个字符。
 * - 译文文档的 `glossaryRef` 记下用的条目、版本与摘要，以及原文里出现过的术语（`terms`）；术语表之后改了，配音核对
 *   译文时据此判断哪几句过期（`glossary-changed`）。
 */

/** 去重之后不超过这么多条时，每批都带上全部术语。 */
export const ALL_TERMS = 30;
/** 每批最多带这么多条术语。 */
export const MAX_TERMS = 60;
/** 每批术语的总字符数上限（按提示词里的行算）。 */
export const MAX_CHARS = 4000;
/** `glossaryRef.terms` 最多记这么多条；超过时 `termsTruncated: true`。 */
export const MAX_RECORDED_TERMS = 2000;
/** 一次翻译最多用这么多张库里的术语表（调用时给的与视频启用的各自不超过）。 */
export const MAX_LIBRARY_GLOSSARIES = 20;

export type GlossaryLibrary = Pick<LibraryStore, 'get'>;

/** 冻结的一张库里的术语表。 */
export interface FrozenGlossary extends FrozenLibraryEntry {
  name: string;
  origin: 'explicit' | 'video';
}

/** 启动时解析出的术语表：冻结的条目，与视频里启用但这次没用的。 */
export interface ResolvedGlossaries {
  entries: FrozenGlossary[];
  skipped: TranslateGlossaryUse['skipped'];
}

/** 写进产物的术语表内容（翻译这一步只读它）。 */
export interface GlossarySnapshot {
  inline: GlossaryEntry[];
  entries: Array<FrozenGlossary & { terms: TranslationGlossary['terms'] }>;
}

/** 一条进提示词的术语；`entryId` 是库里的术语表，调用时直接给的为 null。 */
export interface PromptTerm {
  source: string;
  target: string;
  note?: string;
  entryId: Id | null;
}

/** 译文文档里的 `glossaryRef`（视频格式规范 §5.3）。 */
export interface GlossaryRef {
  entries: Array<{ library: 'glossaries'; id: Id; version: number; contentHash: string; name: string }>;
  inline: { contentHash: string; count: number } | null;
  /** 原文里出现过的术语（翻译时的版本）：哪张表、原文写法与译法。 */
  terms: Array<{ entryId: Id | null; source: string; target: string }>;
  /** 出现的术语多于 `MAX_RECORDED_TERMS` 条、没有记全时为 true。 */
  termsTruncated?: true;
}

/**
 * BCP 47 标签是否相配：相同，或一个是另一个在子标签边界上的前缀（`en` 与 `en-US` 相配，`zh-Hans` 与 `zh-Hant` 不配）。
 */
export function languageMatches(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.startsWith(`${y}-`) || y.startsWith(`${x}-`);
}

/**
 * 启动时解析术语表：调用时给的（`explicit`）不在、不是翻译用、语言不符时拒绝；视频里启用的（`video`）删了或语言不符时
 * 跳过并记下。对外服务的客户端不能用调用时给的库里的术语表，视频启用的也不用。
 */
export function resolveGlossaries(input: {
  library: GlossaryLibrary | undefined;
  explicit: Array<{ id: Id; version?: number }>;
  enabled: Id[];
  targetLanguage: string;
  sourceLanguage: string | null;
  submitter: JobSubmitter | undefined;
}): ResolvedGlossaries {
  const { library, explicit, targetLanguage, sourceLanguage } = input;
  const service = input.submitter?.kind === 'service';
  if (explicit.length > 0) {
    if (service) {
      throw new RpcError('invalid-request', J.serviceClient(), { code: 'LIBRARY_ENTRY_NOT_APPLICABLE', reason: 'service-client' });
    }
    if (!library) throw new RpcError('invalid-request', J.noLibrary());
  }
  const entries: FrozenGlossary[] = [];
  const skipped: ResolvedGlossaries['skipped'] = [];
  const seen = new Set<Id>();
  const languageOk = (g: TranslationGlossary) =>
    languageMatches(g.targetLanguage, targetLanguage) &&
    (g.sourceLanguage === null || sourceLanguage === null || languageMatches(g.sourceLanguage, sourceLanguage));
  for (const ref of explicit) {
    if (seen.has(ref.id)) throw new RpcError('invalid-request', J.duplicate({ id: ref.id }));
    seen.add(ref.id);
    const entry = library!.get({ library: 'glossaries', id: ref.id, ...(ref.version !== undefined ? { version: ref.version } : {}) });
    const content = entry.content;
    if (content.kind !== 'translation') {
      throw new RpcError('invalid-request', J.transcriptionGlossary({ name: content.name }), {
        code: 'LIBRARY_ENTRY_NOT_APPLICABLE',
        library: 'glossaries',
        id: entry.id,
      });
    }
    if (!languageOk(content)) {
      throw new RpcError(
        'invalid-request',
        content.sourceLanguage === null
          ? J.languageMismatchAnySource({ name: content.name, target: content.targetLanguage })
          : J.languageMismatch({ name: content.name, source: content.sourceLanguage, target: content.targetLanguage }),
        {
          code: 'LIBRARY_ENTRY_NOT_APPLICABLE',
          library: 'glossaries',
          id: entry.id,
          targetLanguage: content.targetLanguage,
          sourceLanguage: content.sourceLanguage,
        },
      );
    }
    entries.push({
      library: 'glossaries',
      id: entry.id,
      version: entry.version,
      contentHash: entry.contentHash,
      name: content.name,
      origin: 'explicit',
    });
  }
  if (!service && library) {
    for (const id of input.enabled) {
      if (seen.has(id)) continue;
      seen.add(id);
      let content: TranslationGlossary;
      let frozen: FrozenLibraryEntry;
      try {
        const entry = library.get({ library: 'glossaries', id });
        if (entry.content.kind !== 'translation') continue;
        content = entry.content;
        frozen = { library: 'glossaries', id: entry.id, version: entry.version, contentHash: entry.contentHash };
      } catch {
        skipped.push({ id, reason: 'removed' });
        continue;
      }
      if (!languageOk(content)) {
        skipped.push({ id, reason: 'language' });
        continue;
      }
      entries.push({ ...frozen, name: content.name, origin: 'video' });
    }
  }
  return { entries, skipped };
}

/** 读出冻结版本的内容（启动时，版本已经固定）。 */
export function glossarySnapshot(
  library: GlossaryLibrary | undefined,
  inline: GlossaryEntry[],
  entries: FrozenGlossary[],
): GlossarySnapshot {
  return {
    inline,
    entries: entries.map((e) => {
      const entry = library!.get({ library: 'glossaries', id: e.id, version: e.version });
      return { ...e, terms: entry.content.kind === 'translation' ? entry.content.terms : [] };
    }),
  };
}

/** 全部术语按优先顺序（调用时给的、调用时给的库里的、视频启用的）去重：同一个原文写法（不分大小写）只留第一条。 */
export function promptTerms(snapshot: GlossarySnapshot): PromptTerm[] {
  const out: PromptTerm[] = [];
  const seen = new Set<string>();
  const add = (term: { source: string; target: string; note?: string | null }, entryId: Id | null) => {
    const source = term.source.trim();
    const key = source.toLowerCase();
    if (source === '' || seen.has(key)) return;
    seen.add(key);
    out.push({ source, target: term.target.trim(), ...(term.note ? { note: term.note } : {}), entryId });
  };
  for (const t of snapshot.inline) add(t, null);
  for (const origin of ['explicit', 'video'] as const) {
    for (const entry of snapshot.entries) if (entry.origin === origin) for (const t of entry.terms) add(t, entry.id);
  }
  return out;
}

/**
 * 原文写法是否出现在文本里：不分大小写；只由拉丁字母、数字与常见连接符组成的写法要落在词边界上（`AI` 不匹配 `said`），
 * 其他（中文等）按子串。
 */
export function termOccurs(source: string, text: string): boolean {
  const needle = source.trim();
  if (needle === '') return false;
  if (/^[\p{Script=Latin}\d][\p{Script=Latin}\d .'’&+-]*$/u.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{Script=Latin}\\d])${escaped}(?![\\p{Script=Latin}\\d])`, 'iu').test(text);
  }
  return text.toLowerCase().includes(needle.toLowerCase());
}

const lineLength = (t: PromptTerm) => [...`- ${t.source} → ${t.target}${t.note ? ` (${t.note})` : ''}`].length + 1;

/**
 * 这一批带哪些术语。条数不多（`ALL_TERMS` 以内、放得下）时全部带上；否则只带出现在 `text`（这一批与前文）里的，
 * 按优先顺序截到 `MAX_TERMS` 条、`MAX_CHARS` 个字符。`capped` 是相关但没能放进去的条数。
 */
export function selectTerms(terms: PromptTerm[], text: string): { terms: PromptTerm[]; capped: number } {
  const total = terms.reduce((n, t) => n + lineLength(t), 0);
  if (terms.length <= ALL_TERMS && total <= MAX_CHARS) return { terms, capped: 0 };
  const relevant = terms.filter((t) => termOccurs(t.source, text));
  const picked: PromptTerm[] = [];
  let chars = 0;
  for (const term of relevant) {
    const length = lineLength(term);
    if (picked.length >= MAX_TERMS || chars + length > MAX_CHARS) break;
    picked.push(term);
    chars += length;
  }
  return { terms: picked, capped: relevant.length - picked.length };
}

/** 译文文档的 `glossaryRef`：没有术语表时 null。`terms` 是原文写法出现在原文里的术语（不受提示词上限的影响）。 */
export function glossaryRefOf(snapshot: GlossarySnapshot, sourceText: string): GlossaryRef | null {
  if (snapshot.inline.length === 0 && snapshot.entries.length === 0) return null;
  const terms: GlossaryRef['terms'] = [];
  let truncated = false;
  for (const term of promptTerms(snapshot)) {
    if (!termOccurs(term.source, sourceText)) continue;
    if (terms.length >= MAX_RECORDED_TERMS) {
      truncated = true;
      break;
    }
    terms.push({ entryId: term.entryId, source: term.source, target: term.target });
  }
  return {
    entries: snapshot.entries.map((e) => ({
      library: 'glossaries',
      id: e.id,
      version: e.version,
      contentHash: e.contentHash,
      name: e.name,
    })),
    inline:
      snapshot.inline.length > 0
        ? { contentHash: `sha256:${sha256Hex(canonicalJson(snapshot.inline))}`, count: snapshot.inline.length }
        : null,
    terms,
    ...(truncated ? { termsTruncated: true as const } : {}),
  };
}

/** 读译文正文里的 `glossaryRef`；不是认得的形状时 null（当作没有术语表）。 */
export function readGlossaryRef(value: unknown): GlossaryRef | null {
  const ref = value as Partial<GlossaryRef> | null;
  if (!ref || typeof ref !== 'object' || !Array.isArray(ref.entries) || !Array.isArray(ref.terms)) return null;
  return ref as GlossaryRef;
}

/** 校验 `glossaryRef` 的形状（组装译文时），没有问题时返回空数组。 */
export function glossaryRefProblems(value: unknown): string[] {
  if (value === undefined) return [];
  const ref = readGlossaryRef(value);
  if (!ref) return [J.refMalformed().text];
  const problems: string[] = [];
  for (const e of ref.entries) {
    if (e?.library !== 'glossaries' || typeof e.id !== 'string' || !Number.isInteger(e.version) || typeof e.contentHash !== 'string') {
      problems.push(J.refIncompleteEntry().text);
      break;
    }
  }
  for (const t of ref.terms) {
    if (typeof t?.source !== 'string' || typeof t.target !== 'string' || (t.entryId !== null && typeof t.entryId !== 'string')) {
      problems.push(J.refIncompleteTerm().text);
      break;
    }
  }
  return problems;
}

/**
 * 术语表改了之后，这一句的译文是否过期。`glossaryRef` 里有表此刻的内容摘要变了（或删了）时，按翻译时同样的顺序与去重
 * 得出这句原文里出现的术语此刻的译法（删了的表此刻没有术语；调用时直接给的术语没有「此刻」，照翻译时的），与翻译时
 * 记下的比：有任何不同（译法改了、术语删了、新加的术语出现在这句里）就过期。`termsTruncated` 时记下的术语不全，
 * 有表变了而这句里出现了任何术语就算过期。
 */
export function glossaryChanged(
  ref: GlossaryRef,
  sentenceText: string,
  current: (id: Id) => { contentHash: string; terms: TranslationGlossary['terms'] } | null,
): boolean {
  const now = new Map(ref.entries.map((e) => [e.id, current(e.id)]));
  if (ref.entries.every((e) => now.get(e.id)?.contentHash === e.contentHash)) return false;
  const then = new Map<string, string>();
  for (const t of ref.terms) if (termOccurs(t.source, sentenceText)) then.set(t.source.trim().toLowerCase(), t.target.trim());
  const later = new Map<string, string>();
  const add = (source: string, target: string) => {
    const key = source.trim().toLowerCase();
    if (key !== '' && !later.has(key) && termOccurs(source, sentenceText)) later.set(key, target.trim());
  };
  for (const t of ref.terms) if (t.entryId === null) add(t.source, t.target);
  for (const e of ref.entries) for (const t of now.get(e.id)?.terms ?? []) add(t.source, t.target);
  if (ref.termsTruncated) return then.size > 0 || later.size > 0;
  if (then.size !== later.size) return true;
  for (const [source, target] of then) if (later.get(source) !== target) return true;
  return false;
}
