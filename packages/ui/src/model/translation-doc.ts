import { EditorWasmError, EditorWasmUnavailable, speechSentences as deriveSentences } from '@baocut/editor-wasm';
import type { Id } from '@baocut/protocol';

/**
 * 译文文档（视频格式规范 §5.3，`baocut.translation/2`）在界面这边的读与改：原文的句子、句子的内容指纹、
 * 原文与译文逐句配对、哪一句过期了，以及就地改一句译文。
 *
 * 原文的句子与指纹只有一份规则：字幕与翻译核心（`speech-doc`）的派生，经 `@baocut/editor-wasm` 调同一个 WASM，
 * 与翻译流程冻结原文、Speech Worker 写译文、配音判过期用的是同一份代码（§5.2：停顿不少于 1.8 秒、换说话人、
 * 句末标点断句，分号不断；正文里存下的 `sentences` 不参与；指纹形如 `<词数>:<首词 ID>:<末词 ID>:<FNV-1a>`）。
 */

export const TRANSLATION_SCHEMA = 'baocut.translation/2';
export const SPEECH_SCHEMA = 'baocut.speech/1';

// ---- 原文的句子 ----

export interface SourceSentence {
  /** `s-<首词 ID>`。 */
  id: Id;
  /** 句内可见的词，按词序。 */
  wordIds: Id[];
  text: string;
  /** 核心的内容指纹；与译文单元的 `sourceFingerprint` 比，不同就是原句改过了。 */
  fingerprint: string;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 转写正文的句子连同指纹（同步：WASM 在第一次调用时同步实例化）。正文不是合格的 `baocut.speech/1`，或 WASM 没有构建时
 * null——界面把它当作原文读不出来，不去猜句子。
 */
export function speechSentences(body: unknown): SourceSentence[] | null {
  if (!isObject(body) || body.schema !== SPEECH_SCHEMA) return null;
  try {
    return deriveSentences(body).sentences.map((s) => ({ id: s.id, wordIds: s.wordIds, text: s.text, fingerprint: s.fingerprint }));
  } catch (error) {
    if (error instanceof EditorWasmError || error instanceof EditorWasmUnavailable) return null;
    throw error;
  }
}

/** UTF-8 文本的 SHA-256（十六进制）。 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 译文文本的摘要（`alignment.textHash`，§5.3），与句子指纹无关。 */
export async function textHash(text: string): Promise<string> {
  return `sha256:${await sha256Hex(text)}`;
}

// ---- 译文 ----

export interface TranslationUnit {
  id: Id;
  sourceSentenceId: Id;
  sourceFingerprint: string;
  naturalText: string;
  displayRewrite?: { text: string; reason: string; reviewed: boolean };
  alignment: {
    basis: 'natural' | 'display-rewrite';
    correspondence: 'block' | 'sentence';
    blocks: unknown[];
    sourceWordIds: Id[];
    textHash: string;
  } | null;
  status: 'draft' | 'reviewed' | 'stale';
}

export interface TranslationBody {
  schema: typeof TRANSLATION_SCHEMA;
  language: string;
  sourceBasis: { speechRef: { id: Id; revision: string }; sequenceId: Id; scopeLineage: Id[]; editViewHash: string };
  glossaryRef?: unknown;
  units: TranslationUnit[];
}

/** 读 `/2` 的译文正文；别的格式（旧项目的 `/1`）返回 null，界面只读不改。 */
export function readTranslation(body: unknown): TranslationBody | null {
  if (!isObject(body) || body.schema !== TRANSLATION_SCHEMA || !Array.isArray(body.units)) return null;
  const units = body.units.filter(
    (u): u is TranslationUnit =>
      isObject(u) && typeof u.id === 'string' && typeof u.sourceSentenceId === 'string' && typeof u.naturalText === 'string',
  );
  return units.length === body.units.length ? (body as unknown as TranslationBody) : null;
}

/** 画面与导出用的译文：有字幕显示改写时用它（§5.3 的双语合并同一个取法）。 */
export function unitText(unit: Pick<TranslationUnit, 'naturalText' | 'displayRewrite'>): string {
  return (unit.displayRewrite?.text || unit.naturalText).trim();
}

/**
 * 一句译文的状态（照 jobs 的 dub.ts 判过期的顺序）：
 * - `marked-stale`：文档里标了 `status: 'stale'`；
 * - `sentence-gone`：原句不在转写里了；
 * - `source-changed`：原句的内容指纹与翻译时的不同（改了字、增删了词）；
 * - `empty`：没有译文；
 * - `untranslated`：原句还没有对应的译文单元（翻译之后新出现的句子）。
 */
export type UnitState = 'ok' | 'marked-stale' | 'sentence-gone' | 'source-changed' | 'empty' | 'untranslated';

export function unitState(unit: TranslationUnit | null, sentence: SourceSentence | null): UnitState {
  if (!unit) return 'untranslated';
  if (unit.status === 'stale') return 'marked-stale';
  if (!sentence) return 'sentence-gone';
  if (sentence.fingerprint !== unit.sourceFingerprint) return 'source-changed';
  if (unitText(unit) === '') return 'empty';
  return 'ok';
}

/** 过期：标了过期，或原句改过。 */
export const isStale = (state: UnitState) => state === 'marked-stale' || state === 'source-changed';

export interface PairRow {
  key: string;
  sentence: SourceSentence | null;
  unit: TranslationUnit | null;
  state: UnitState;
}

/**
 * 原文与译文逐句配对：按转写的句子次序；原句已经没了的译文单元排在它在译文里前一个单元的后面；
 * 翻译之后新出现、还没有译文的句子也列出来（state `untranslated`）。
 */
export function pairRows(sentences: readonly SourceSentence[], translation: TranslationBody): PairRow[] {
  const bySentence = new Map<Id, TranslationUnit>();
  for (const unit of translation.units) if (!bySentence.has(unit.sourceSentenceId)) bySentence.set(unit.sourceSentenceId, unit);
  const known = new Set(sentences.map((s) => s.id));
  // 原句没了的单元挂在前一个还在的单元的句子后面；开头就没了的挂在 '' 上。
  const orphans = new Map<string, TranslationUnit[]>();
  let anchor = '';
  for (const unit of translation.units) {
    if (known.has(unit.sourceSentenceId) && bySentence.get(unit.sourceSentenceId) === unit) {
      anchor = unit.sourceSentenceId;
      continue;
    }
    orphans.set(anchor, [...(orphans.get(anchor) ?? []), unit]);
  }
  const gone = (anchorId: string): PairRow[] =>
    (orphans.get(anchorId) ?? []).map((unit) => {
      // 同一句被两个单元对着（重复的单元）：后面那个也按原句还在算，只是不再配对。
      const sentence = sentences.find((s) => s.id === unit.sourceSentenceId) ?? null;
      return { key: unit.id, sentence, unit, state: unitState(unit, sentence) };
    });
  const rows: PairRow[] = [...gone('')];
  for (const sentence of sentences) {
    const unit = bySentence.get(sentence.id) ?? null;
    rows.push({ key: unit?.id ?? `s:${sentence.id}`, sentence, unit, state: unitState(unit, sentence) });
    rows.push(...gone(sentence.id));
  }
  return rows;
}

export interface PairStats {
  /** 有原句的行。 */
  sentences: number;
  /** 还没有译文的句子（没有单元或译文是空的）。 */
  untranslated: number;
  /** 过期的译文。 */
  stale: number;
  /** 原句已经不在的译文。 */
  gone: number;
}

export function pairStats(rows: readonly PairRow[]): PairStats {
  return {
    sentences: rows.filter((r) => r.sentence && r.state !== 'sentence-gone').length,
    untranslated: rows.filter((r) => r.state === 'untranslated' || r.state === 'empty').length,
    stale: rows.filter((r) => isStale(r.state)).length,
    gone: rows.filter((r) => r.state === 'sentence-gone').length,
  };
}

// ---- 改一句 ----

/** 能就地改的行：原句还在。原句没了的单元只读（改了也没有地方放）。 */
export const editableRow = (row: PairRow) => row.sentence !== null && row.state !== 'sentence-gone';

/**
 * 就地改一句译文，返回新的正文与改动的单元；文字没变、或这一行不能改时 null。
 *
 * - 有字幕显示改写的单元改的是改写（`naturalText` 不动，§5.3：改写不得覆盖自然译文）；否则改 `naturalText` 并更新 `textHash`。
 * - 改过的单元记为 `reviewed`；原句改过或标了过期的，用户对着现在的原文改，单元的指纹与词成员换成现在这一句的。
 * - 还没有译文的句子新建一个单元，插在前面最近一句已有译文的单元后面。
 */
export async function editUnit(
  body: TranslationBody,
  sentences: readonly SourceSentence[],
  row: PairRow,
  text: string,
): Promise<{ body: TranslationBody; unit: TranslationUnit } | null> {
  if (!editableRow(row)) return null;
  const sentence = row.sentence!;
  const value = text.trim();
  const current = row.unit;
  if (current) {
    if (value === unitText(current)) return null;
    const rebind = row.state === 'source-changed' || row.state === 'marked-stale';
    const alignment = current.alignment ? { ...current.alignment, ...(rebind ? { sourceWordIds: [...sentence.wordIds] } : {}) } : null;
    let next: TranslationUnit;
    if (current.displayRewrite) {
      next = { ...current, displayRewrite: { ...current.displayRewrite, text: value, reviewed: true }, alignment };
    } else {
      next = { ...current, naturalText: value, alignment: alignment ? { ...alignment, textHash: await textHash(value) } : null };
    }
    next = { ...next, status: 'reviewed', ...(rebind ? { sourceFingerprint: sentence.fingerprint } : {}) };
    return { body: { ...body, units: body.units.map((u) => (u === current ? next : u)) }, unit: next };
  }
  if (value === '') return null;
  const ids = new Set(body.units.map((u) => u.id));
  let id = `t-${sentence.id}`;
  for (let n = 2; ids.has(id); n++) id = `t-${sentence.id}-${n}`;
  const unit: TranslationUnit = {
    id,
    sourceSentenceId: sentence.id,
    sourceFingerprint: sentence.fingerprint,
    naturalText: value,
    alignment: {
      basis: 'natural',
      correspondence: 'sentence',
      blocks: [],
      sourceWordIds: [...sentence.wordIds],
      textHash: await textHash(value),
    },
    status: 'reviewed',
  };
  // 插在前面最近一句已有译文的单元后面；前面都没有时放在最前。
  const order = sentences.findIndex((s) => s.id === sentence.id);
  let at = 0;
  for (let i = order - 1; i >= 0; i--) {
    const found = body.units.findIndex((u) => u.sourceSentenceId === sentences[i]!.id);
    if (found >= 0) {
      at = found + 1;
      break;
    }
  }
  const units = [...body.units.slice(0, at), unit, ...body.units.slice(at)];
  return { body: { ...body, units }, unit };
}
