import type { JobsTranslationBatchesMessages } from './translation-batches.ts';

export const ja: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: 'パラメータ glossary の各項目には空でない source と target が必要です',
  glossaryNoteInvalid: 'パラメータ glossary の note は文字列である必要があります',
  glossariesItemInvalid: 'パラメータ glossaries の各項目には用語集の ID が必要です',
  glossariesUnknownFields: (p: { fields: string }) => `パラメータ glossaries の項目に不明なフィールドがあります：${p.fields}`,
  glossariesVersionInvalid: 'パラメータ glossaries の version は正の整数である必要があります',
  cannotFreezeGlossaries: 'この Runtime では用語集の内容を固定できません',
  artifactGone: (p: { artifactId: string }) => `生成物 ${p.artifactId} はもう存在しません`,
  batchFailedSentences: (p: { first: number; last: number; retries: number }) =>
    `${p.first}〜${p.last} 文目の翻訳は、${p.retries} 回再試行しても想定の形式に合いませんでした`,
  batchFailedCues: (p: { first: number; last: number; retries: number }) =>
    `${p.first}〜${p.last} 番目の字幕の翻訳は、${p.retries} 回再試行しても想定の形式に合いませんでした`,
  outputNoTranslations: '出力に translations がありません',
  outputCountMismatch: (p: { output: number; input: number }) => `出力には ${p.output} 件の項目がありますが、入力は ${p.input} 文です`,
  outputIncompleteItem: '出力に id または翻訳のない項目があります',
  outputDuplicateId: (p: { id: string }) => `出力に ${p.id} が 2 回含まれています`,
  outputMissingIds: (p: { ids: string }) => `出力に ${p.ids} がありません`,
};
