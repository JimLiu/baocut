import type { JobsTranslationDocumentMessages } from './translation-document.ts';

export const zhHans: JobsTranslationDocumentMessages = {
  notSpeech: '源文档不是 baocut.speech/1 的转写',
  unreadable: '转写读不了',
  notObject: '正文不是对象',
  schemaShouldBe: (p: { schema: string }) => `schema 应为 ${p.schema}`,
  missingLanguage: '缺少 language',
  basisMismatch: 'sourceBasis 与冻结的原文不符',
  basisDerivationMismatch: 'sourceBasis 的序列或 editViewHash 与冻结的原文不符（句子不是按同一套规则派生的）',
  missingUnits: '缺少 units',
  unitCountMismatch: (p: { units: number; sentences: number }) => `有 ${p.units} 个译文单元，原文有 ${p.sentences} 句`,
  unitDuplicate: (p: { id: string }) => `译文单元 ${p.id} 重复`,
  unitSentenceMismatch: (p: { n: number }) => `第 ${p.n} 个译文单元与原文的句子对不上`,
  unitMissingSource: (p: { n: number }) => `第 ${p.n} 个译文单元缺少原文句子或指纹`,
  unitNoText: (p: { id: string }) => `译文单元 ${p.id} 没有译文`,
  unitBadStatus: (p: { id: string }) => `译文单元 ${p.id} 的 status 不合法`,
  unitBadAlignment: (p: { id: string }) => `译文单元 ${p.id} 的 alignment 不合法`,
  unitAlignmentFields: (p: { id: string }) => `译文单元 ${p.id} 的 alignment 缺字段`,
  unitHashMismatch: (p: { id: string }) => `译文单元 ${p.id} 的 textHash 与译文不符`,
  unitExtraFields: (p: { id: string; fields: string }) => `译文单元 ${p.id} 有 §5.3 之外的字段：${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `正文有 §5.3 之外的字段：${p.fields}`,
};
