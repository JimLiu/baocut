import type { DocumentRecord, Id } from '@baocut/protocol';
import { EditorWasmUnavailable, sha256Hex, sourceSentences } from '@baocut/jobs';

/**
 * 智能体写译文时 Runtime 补上的句级对齐（视频格式规范 §5.3，架构设计 §3.5 的 `documents_read`）。
 *
 * 智能体自己翻译时按句子写单元，不做块级对齐；`alignment` 写 null 时，导出要按句子重新派生成员，`captions_create`
 * 切不出时间。`edits_apply` 的 `putDocument` 写 `baocut.translation/2` 时，这里按单元的 `sourceSentenceId` 在它译自的
 * 转写里找到那一句（与 `documents_read` 的 `translationBasis` 同一套规则，经 editor-wasm），把 null 补成句级对齐
 * `{basis:'natural', correspondence:'sentence', blocks:[], sourceWordIds:<那一句的词>, textHash}`；写了对齐却缺
 * `sourceWordIds` 或 `textHash` 的同样补齐，句级、没有块的对齐的 `textHash` 按译文重算。
 *
 * 只补核对得上的：句子在转写里找得到，单元的 `sourceFingerprint` 与那一句的相同（或没写）。过期的单元、找不到的句子、
 * 指纹对不上的不动；转写读不了、句子的 WASM 没有构建时只补写了对齐对象却缺的 `textHash`，其余照原样交给引擎。`textHash` 是 `"sha256:"` 加译文
 * （`naturalText`）的 UTF-8 SHA-256 十六进制，与翻译流程的核对相同。
 */

/** 读转写正文：给了版本时读那一版。读不到时抛出。 */
export type SpeechBodyReader = (documentId: Id, revision?: string) => Promise<unknown>;

type Json = Record<string, unknown>;

const TRANSLATION_V2 = 'baocut.translation/2';

/**
 * 在 `operations`（已经规范化、发给引擎之前）里给译文的 `putDocument` 补对齐；返回补了几个单元。改动写在新的 `body`
 * 对象上（替换 `op.body`），不改调用方传进来的正文。
 */
export async function fillTranslationAlignments(
  operations: Record<string, unknown>[],
  documents: Readonly<Record<Id, DocumentRecord>>,
  readSpeech: SpeechBodyReader,
): Promise<number> {
  let filled = 0;
  for (const op of operations) {
    if (op.type !== 'putDocument' || op.kind !== 'translation') continue;
    const body = op.body as Json | null | undefined;
    if (!body || typeof body !== 'object' || body.schema !== TRANSLATION_V2 || !Array.isArray(body.units)) continue;
    const speechRef = (body.sourceBasis as { speechRef?: { id?: unknown; revision?: unknown } } | undefined)?.speechRef;
    const speechId =
      stringOf((op.sourceDocument as { documentId?: unknown } | undefined)?.documentId) ??
      stringOf(speechRef?.id) ??
      (typeof op.documentId === 'string' ? (documents[op.documentId]?.sourceDocumentId ?? null) : null);
    // 读不到句子时只补不靠句子的 `textHash`（写了对齐对象却没写它的）。
    const sentences = (speechId ? await sentencesOf(readSpeech, speechId, stringOf(speechRef?.revision) ?? undefined) : null) ?? new Map();
    let changed = 0;
    const units = (body.units as unknown[]).map((raw) => {
      const next = filledUnit(raw, sentences);
      if (next !== raw) changed++;
      return next;
    });
    if (changed) {
      op.body = { ...body, units };
      filled += changed;
    }
  }
  return filled;
}

type Sentences = Map<string, { fingerprint: string; wordIds: string[] }>;

/** 那一版转写的句子；读不到（先按记下的版本，再按当前版本）、正文不对或 WASM 不在时 null。 */
async function sentencesOf(readSpeech: SpeechBodyReader, speechId: Id, revision: string | undefined): Promise<Sentences | null> {
  let body: unknown;
  try {
    body = await readSpeech(speechId, revision);
  } catch {
    if (revision === undefined) return null;
    try {
      body = await readSpeech(speechId);
    } catch {
      return null;
    }
  }
  let read: ReturnType<typeof sourceSentences>;
  try {
    read = sourceSentences(body);
  } catch (error) {
    if (error instanceof EditorWasmUnavailable) return null;
    throw error;
  }
  if ('problem' in read) return null;
  return new Map(read.sentences.map((s) => [s.id, { fingerprint: s.fingerprint, wordIds: [...s.wordIds] }]));
}

/** 补好的单元；不用补或补不了时原样返回同一个对象。 */
function filledUnit(raw: unknown, sentences: Sentences): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const unit = raw as Json;
  if (unit.status === 'stale' || typeof unit.naturalText !== 'string' || unit.naturalText.trim() === '') return raw;
  const textHash = `sha256:${sha256Hex(unit.naturalText)}`;
  const sentence = typeof unit.sourceSentenceId === 'string' ? sentences.get(unit.sourceSentenceId) : undefined;
  const matches =
    sentence !== undefined &&
    (typeof unit.sourceFingerprint !== 'string' || unit.sourceFingerprint === '' || unit.sourceFingerprint === sentence.fingerprint);
  const alignment = unit.alignment;
  if (alignment === null || alignment === undefined) {
    if (!matches) return raw;
    return {
      ...unit,
      alignment: { basis: 'natural', correspondence: 'sentence', blocks: [], sourceWordIds: sentence.wordIds, textHash },
    };
  }
  if (typeof alignment !== 'object' || Array.isArray(alignment)) return raw;
  const a = alignment as Json;
  const next: Json = { ...a };
  if (!Array.isArray(a.sourceWordIds) && matches) next.sourceWordIds = sentence.wordIds;
  // 句级、没有块也没有拆分的对齐只认整句：译文改过时 textHash 跟着译文重算。块级的不动（块的对应要重新对齐）。
  const sentenceLevel = a.correspondence === 'sentence' && Array.isArray(a.blocks) && a.blocks.length === 0 && a.split === undefined;
  if (typeof a.textHash !== 'string' || (sentenceLevel && a.textHash !== textHash)) next.textHash = textHash;
  const changed = next.sourceWordIds !== a.sourceWordIds || next.textHash !== a.textHash;
  return changed ? { ...unit, alignment: next } : raw;
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
