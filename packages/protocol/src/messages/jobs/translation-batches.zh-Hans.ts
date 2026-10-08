import type { JobsTranslationBatchesMessages } from './translation-batches.ts';

export const zhHans: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: '参数 glossary 的每一项应有非空的 source 与 target',
  glossaryNoteInvalid: '参数 glossary 的 note 应为字符串',
  glossariesItemInvalid: '参数 glossaries 的每一项应有术语表的 id',
  glossariesUnknownFields: (p: { fields: string }) => `参数 glossaries 的项不认识 ${p.fields}`,
  glossariesVersionInvalid: '参数 glossaries 的 version 应为正整数',
  cannotFreezeGlossaries: '这个 Runtime 不能冻结术语表的内容',
  artifactGone: (p: { artifactId: string }) => `产物 ${p.artifactId} 已经不在了`,
  batchFailedSentences: (p: { first: number; last: number; retries: number }) =>
    `第 ${p.first}–${p.last} 句的译文重发 ${p.retries} 次后仍不合约定`,
  batchFailedCues: (p: { first: number; last: number; retries: number }) => `第 ${p.first}–${p.last} 条的译文重发 ${p.retries} 次后仍不合约定`,
  outputNoTranslations: '输出没有 translations',
  outputCountMismatch: (p: { output: number; input: number }) => `输出 ${p.output} 条，输入 ${p.input} 句`,
  outputIncompleteItem: '输出里有缺少 id 或译文的条目',
  outputDuplicateId: (p: { id: string }) => `输出里 ${p.id} 出现了两次`,
  outputMissingIds: (p: { ids: string }) => `输出缺少 ${p.ids}`,
};
