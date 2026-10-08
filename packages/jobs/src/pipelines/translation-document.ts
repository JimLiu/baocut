import { refOf, type Id, type Localized, type MessageRef } from '@baocut/protocol';
import { JobsTranslationDocument as J } from '@baocut/protocol/messages/jobs/translation-document.ts';
import { EditorWasmError, SENTENCE_DERIVATION, speechSentences, type SourceSentence } from '@baocut/editor-wasm';
import { sha256Hex } from '../input-hash.ts';
import { joinList, withCause } from '../job-text.ts';
import { glossaryRefProblems, type GlossaryRef } from './translation-glossary.ts';

/**
 * 翻译流程的原文与译文文档（视频格式规范 §5.2、§5.3）。
 *
 * 原文：`baocut.speech/1` 的句子与内容指纹只有一套规则，字幕与翻译核心（`speech-doc`）的 `derive_sentences`，
 * 经 `@baocut/editor-wasm` 调同一份 Rust（界面、Speech Worker 用的也是它）：句末标点（分号不断句）、停顿不少于 1.8 秒、
 * 换说话人、句内 80 词、分段与章节边界断句；隐藏的词不进句子；正文里存下的 `sentences` 不参与。句子 ID 是 `s-<首词 ID>`，
 * 指纹是 `<词数>:<首词 ID>:<末词 ID>:<FNV-1a 的 36 进制>`，`editViewHash` 是规则名 `speech-doc/sentences` 与全部句子的
 * ID、指纹的摘要。
 *
 * 译文：`baocut.translation/2`，字段严格按 §5.3 的 `TranslationDocumentVersion`；`id` 与 `revision` 是文档记录的，
 * 正文里不重复。整份转写一起翻译时 `sourceBasis.scopeLineage` 为空（范围就是整份文档）。
 */

export { SENTENCE_DERIVATION, type SourceSentence };
export const TRANSLATION_SCHEMA = 'baocut.translation/2';

/** 冻结的原文：哪份文档的哪个版本、在哪个序列上、怎么切的句子。发布为产物，后面的步骤只读它。 */
export interface FrozenSource {
  derivation: string;
  speechRef: { id: Id; revision: string };
  sequenceId: Id;
  language: string | null;
  editViewHash: string;
  /** 转写正文的 `timescale`：句子的 `start` / `end` 按它计。 */
  timescale: number;
  sentences: SourceSentence[];
}

/**
 * 读 `speech` 正文的句子；正文不是 `baocut.speech/1`、词缺源时间或说话人不合法时返回问题。
 * 句子与指纹的 WASM 没有构建时抛 `EditorWasmUnavailable`（先运行 `npm run build:wasm`）。
 */
export function sourceSentences(
  body: unknown,
): { sentences: SourceSentence[]; derivation: string; editViewHash: string; timescale: number } | { problem: string; problemRef: MessageRef } {
  const speech = body as { schema?: unknown; words?: unknown } | null;
  if (!speech || typeof speech !== 'object' || speech.schema !== 'baocut.speech/1' || !Array.isArray(speech.words)) {
    return problemOf(J.notSpeech());
  }
  try {
    const read = speechSentences(body);
    return { sentences: read.sentences, derivation: read.derivation, editViewHash: read.editViewHash, timescale: read.timescale };
  } catch (error) {
    if (error instanceof EditorWasmError) return problemOf(withCause(J.unreadable(), error));
    throw error;
  }
}

/** 读不了原文的说明：文本与它的引用（`asLocalized(problem, problemRef)` 可以连同引用抛出）。 */
function problemOf(text: Localized): { problem: string; problemRef: MessageRef } {
  return { problem: text.text, problemRef: refOf(text) };
}

/** 把几行文本接成一句（字幕文件的一条字幕送模型时用）：自带空白时照用；两个拉丁字母数字之间没有空白时补一个空格；中文不加空格。 */
export function joinWords(texts: string[]): string {
  let out = '';
  for (const text of texts) {
    if (
      out !== '' &&
      !/\s$/.test(out) &&
      !/^\s/.test(text) &&
      /[\p{Script=Latin}\d,.!?;:'"%)]$/u.test(out) &&
      /^[\p{Script=Latin}\d(]/u.test(text)
    ) {
      out += ' ';
    }
    out += text;
  }
  return out.replace(/\s+/g, ' ').trim();
}

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
  glossaryRef?: GlossaryRef;
  units: TranslationUnit[];
}

/**
 * 按 §5.3 校验译文正文，并核对它与冻结的原文逐句对应：单元的句子 ID 与指纹是那一句的，`sourceBasis` 指向同一个序列、
 * `editViewHash` 相同（译文的句子与这里按同一套规则派生）。没有问题时返回空数组。
 */
export function translationProblems(body: unknown, source: FrozenSource): string[] {
  return documentProblems(body, source.speechRef, source);
}

/**
 * 只按 §5.3 校验译文正文的形状与它指向的原文版本，不核对句子：句子由别处的规则派生时（Speech Worker 按字幕与翻译核心的
 * 句子规则，架构设计 §7.9）用它。
 */
export function translationShapeProblems(body: unknown, speechRef: { id: Id; revision: string }): string[] {
  return documentProblems(body, speechRef, null);
}

function documentProblems(body: unknown, speechRef: { id: Id; revision: string }, source: FrozenSource | null): string[] {
  const problems: string[] = [];
  const t = body as Partial<TranslationBody> | null;
  if (!t || typeof t !== 'object') return [J.notObject().text];
  if (t.schema !== TRANSLATION_SCHEMA) problems.push(J.schemaShouldBe({ schema: TRANSLATION_SCHEMA }).text);
  if (typeof t.language !== 'string' || t.language === '') problems.push(J.missingLanguage().text);
  const basis = t.sourceBasis;
  if (
    !basis ||
    basis.speechRef?.id !== speechRef.id ||
    basis.speechRef?.revision !== speechRef.revision ||
    typeof basis.sequenceId !== 'string' ||
    !Array.isArray(basis.scopeLineage) ||
    typeof basis.editViewHash !== 'string'
  ) {
    problems.push(J.basisMismatch().text);
  }
  if (source && basis && (basis.sequenceId !== source.sequenceId || basis.editViewHash !== source.editViewHash)) {
    problems.push(J.basisDerivationMismatch().text);
  }
  problems.push(...glossaryRefProblems(t.glossaryRef));
  if (!Array.isArray(t.units)) return [...problems, J.missingUnits().text];
  if (source && t.units.length !== source.sentences.length) {
    problems.push(J.unitCountMismatch({ units: t.units.length, sentences: source.sentences.length }).text);
  }
  const ids = new Set<string>();
  t.units.forEach((unit, i) => {
    if (ids.has(unit.id)) problems.push(J.unitDuplicate({ id: unit.id }).text);
    ids.add(unit.id);
    if (source) {
      const sentence = source.sentences[i];
      if (!sentence || unit.sourceSentenceId !== sentence.id || unit.sourceFingerprint !== sentence.fingerprint) {
        problems.push(J.unitSentenceMismatch({ n: i + 1 }).text);
      }
    } else if (
      typeof unit.sourceSentenceId !== 'string' ||
      unit.sourceSentenceId === '' ||
      typeof unit.sourceFingerprint !== 'string' ||
      unit.sourceFingerprint === ''
    ) {
      problems.push(J.unitMissingSource({ n: i + 1 }).text);
    }
    if (typeof unit.naturalText !== 'string' || unit.naturalText.trim() === '') problems.push(J.unitNoText({ id: unit.id }).text);
    if (!['draft', 'reviewed', 'stale'].includes(unit.status)) problems.push(J.unitBadStatus({ id: unit.id }).text);
    const a = unit.alignment;
    if (a !== null) {
      if (!a || !['natural', 'display-rewrite'].includes(a.basis) || !['block', 'sentence'].includes(a.correspondence)) {
        problems.push(J.unitBadAlignment({ id: unit.id }).text);
      } else if (!Array.isArray(a.blocks) || !Array.isArray(a.sourceWordIds) || typeof a.textHash !== 'string') {
        problems.push(J.unitAlignmentFields({ id: unit.id }).text);
      } else if (a.textHash !== `sha256:${sha256Hex(unit.naturalText)}`) {
        problems.push(J.unitHashMismatch({ id: unit.id }).text);
      }
    }
    const extra = Object.keys(unit).filter(
      (k) => !['id', 'sourceSentenceId', 'sourceFingerprint', 'naturalText', 'displayRewrite', 'alignment', 'status'].includes(k),
    );
    if (extra.length > 0) problems.push(J.unitExtraFields({ id: unit.id, fields: joinList(extra) }).text);
  });
  const extra = Object.keys(t).filter((k) => !['schema', 'language', 'sourceBasis', 'glossaryRef', 'units'].includes(k));
  if (extra.length > 0) problems.push(J.bodyExtraFields({ fields: joinList(extra) }).text);
  return problems;
}
