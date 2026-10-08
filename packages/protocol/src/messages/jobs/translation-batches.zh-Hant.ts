import type { JobsTranslationBatchesMessages } from './translation-batches.ts';

export const zhHant: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: '參數 glossary 的每一項都必須有非空的 source 與 target',
  glossaryNoteInvalid: '參數 glossary 的 note 必須是字串',
  glossariesItemInvalid: '參數 glossaries 的每一項都必須有術語表 id',
  glossariesUnknownFields: (p: { fields: string }) => `參數 glossaries 的項目含有未知欄位：${p.fields}`,
  glossariesVersionInvalid: '參數 glossaries 的 version 必須是正整數',
  cannotFreezeGlossaries: '這個 Runtime 無法凍結術語表的內容',
  artifactGone: (p: { artifactId: string }) => `產出 ${p.artifactId} 已不存在`,
  batchFailedSentences: (p: { first: number; last: number; retries: number }) =>
    `第 ${p.first}–${p.last} 句的譯文重試 ${p.retries} 次後仍不符合預期格式`,
  batchFailedCues: (p: { first: number; last: number; retries: number }) => `第 ${p.first}–${p.last} 條字幕的譯文重試 ${p.retries} 次後仍不符合預期格式`,
  outputNoTranslations: '輸出中沒有 translations',
  outputCountMismatch: (p: { output: number; input: number }) => `輸出有 ${p.output} 項，輸入有 ${p.input} 句`,
  outputIncompleteItem: '輸出中有項目缺少 id 或譯文',
  outputDuplicateId: (p: { id: string }) => `${p.id} 在輸出中出現了兩次`,
  outputMissingIds: (p: { ids: string }) => `輸出缺少 ${p.ids}`,
};
