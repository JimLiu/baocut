import type { JobsTranslationDocumentMessages } from './translation-document.ts';

export const zhHant: JobsTranslationDocumentMessages = {
  notSpeech: '來源文件不是 baocut.speech/1 逐字稿',
  unreadable: '無法讀取逐字稿',
  notObject: '內文不是物件',
  schemaShouldBe: (p: { schema: string }) => `schema 必須是 ${p.schema}`,
  missingLanguage: '缺少 language',
  basisMismatch: 'sourceBasis 與凍結的原文不符',
  basisDerivationMismatch: 'sourceBasis 中的序列或 editViewHash 與凍結的原文不符（句子不是依同一套規則衍生的）',
  missingUnits: '缺少 units',
  unitCountMismatch: (p: { units: number; sentences: number }) => `有 ${p.units} 個譯文單元，但原文有 ${p.sentences} 句`,
  unitDuplicate: (p: { id: string }) => `譯文單元 ${p.id} 重複`,
  unitSentenceMismatch: (p: { n: number }) => `第 ${p.n} 個譯文單元與原文句子不一致`,
  unitMissingSource: (p: { n: number }) => `第 ${p.n} 個譯文單元缺少原文句子或指紋`,
  unitNoText: (p: { id: string }) => `譯文單元 ${p.id} 沒有譯文`,
  unitBadStatus: (p: { id: string }) => `譯文單元 ${p.id} 的 status 無效`,
  unitBadAlignment: (p: { id: string }) => `譯文單元 ${p.id} 的 alignment 無效`,
  unitAlignmentFields: (p: { id: string }) => `譯文單元 ${p.id} 的 alignment 缺少欄位`,
  unitHashMismatch: (p: { id: string }) => `譯文單元 ${p.id} 的 textHash 與譯文不符`,
  unitExtraFields: (p: { id: string; fields: string }) => `譯文單元 ${p.id} 含有 §5.3 以外的欄位：${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `內文含有 §5.3 以外的欄位：${p.fields}`,
};
