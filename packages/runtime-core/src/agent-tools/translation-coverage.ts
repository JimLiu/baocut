import type { DocumentRecord, Id } from '@baocut/protocol';
import { EditorWasmUnavailable, refreshPlan, refreshableTranslation, sourceSentences } from '@baocut/jobs';

/**
 * 一份译文覆盖了它译自的转写的多少句（架构设计 §3.5 的 `documents_read` translateTo）。智能体分批写长译文：第一批
 * `documents_put` 新建，之后 `edits_apply` 的 `patchDocument` 追加单元。写入后 Runtime 用这里的数字决定进度记录是否完成、
 * 回合结束时是否还算没做完，并在回执里告诉智能体还差多少句。
 *
 * 一句算译好的判法与编辑器（`unitState`）、就地刷新（`refreshPlan`）相同：有单元、没标过期、指纹与转写当前的那一句相同、
 * 译文不空。
 */

/** 覆盖的句数、转写的总句数，与第一句还没译好的句子（按转写的句序；全部译好时 null）。 */
export interface TranslationCoverage {
  covered: number;
  total: number;
  nextSentenceId: Id | null;
}

/** 一笔修改写到的译文：`put` 为整份写入（`putDocument`），否则是给已有译文打的补丁（`patchDocument`）。 */
export interface WrittenTranslation {
  documentId: Id | null;
  put: boolean;
  /** 操作里写明的转写与语言（`putDocument` 才有）；没写时按写入后的文档记录。 */
  sourceDocumentId: Id | null;
  language: string | null;
}

/**
 * 从发给引擎的操作里挑出写译文的：`putDocument` kind `translation`（新建的按 `ref` 在回执的 `refs` 里找 ID），与给已有
 * 译文（`documents` 是提交前的文档表）打的 `patchDocument`。同一份文档只报一次，整份写入优先。
 */
export function writtenTranslations(
  operations: readonly Record<string, unknown>[],
  documents: Readonly<Record<Id, DocumentRecord>>,
  refs: Readonly<Record<string, Id>> | undefined,
): WrittenTranslation[] {
  const written = new Map<string, WrittenTranslation>();
  for (const op of operations) {
    if (op.type === 'putDocument' && op.kind === 'translation') {
      const documentId =
        typeof op.documentId === 'string' ? op.documentId : typeof op.ref === 'string' ? (refs?.[op.ref] ?? null) : null;
      const source = (op.sourceDocument as { documentId?: unknown } | undefined)?.documentId;
      written.set(documentId ?? `put:${written.size}`, {
        documentId,
        put: true,
        sourceDocumentId: typeof source === 'string' ? source : null,
        language: typeof op.language === 'string' ? op.language : null,
      });
    } else if (op.type === 'patchDocument' && typeof op.documentId === 'string' && documents[op.documentId]?.kind === 'translation') {
      if (!written.has(op.documentId)) written.set(op.documentId, { documentId: op.documentId, put: false, sourceDocumentId: null, language: null });
    }
  }
  return [...written.values()];
}

/** 译文正文对转写正文的覆盖；读不出（不是 `baocut.translation/2`、转写切不出句子、句子的 WASM 没有构建）时 null。 */
export function translationCoverage(translationBody: unknown, speechBody: unknown): TranslationCoverage | null {
  const translation = refreshableTranslation(translationBody);
  if (!translation) return null;
  let read: ReturnType<typeof sourceSentences>;
  try {
    read = sourceSentences(speechBody);
  } catch (error) {
    if (error instanceof EditorWasmUnavailable) return null;
    throw error;
  }
  if ('problem' in read) return null;
  const plan = refreshPlan(translation, read.sentences, undefined);
  if ('unknown' in plan) return null;
  const total = read.sentences.length;
  return { covered: total - plan.sentences.length, total, nextSentenceId: plan.sentences[0] ?? null };
}
