import type { JobsTranslationDocumentMessages } from './translation-document.ts';

export const ja: JobsTranslationDocumentMessages = {
  notSpeech: '元のドキュメントが baocut.speech/1 の文字起こしではありません',
  unreadable: '文字起こしを読み取れませんでした',
  notObject: '本文がオブジェクトではありません',
  schemaShouldBe: (p: { schema: string }) => `schema は ${p.schema} である必要があります`,
  missingLanguage: 'language がありません',
  basisMismatch: 'sourceBasis が固定した原文と一致しません',
  basisDerivationMismatch:
    'sourceBasis のシーケンスまたは editViewHash が固定した原文と一致しません（文が同じ規則で導出されていません）',
  missingUnits: 'units がありません',
  unitCountMismatch: (p: { units: number; sentences: number }) => `翻訳ユニットは ${p.units} 個ですが、原文は ${p.sentences} 文です`,
  unitDuplicate: (p: { id: string }) => `翻訳ユニット ${p.id} が重複しています`,
  unitSentenceMismatch: (p: { n: number }) => `${p.n} 番目の翻訳ユニットが原文の文と一致しません`,
  unitMissingSource: (p: { n: number }) => `${p.n} 番目の翻訳ユニットに原文の文またはフィンガープリントがありません`,
  unitNoText: (p: { id: string }) => `翻訳ユニット ${p.id} に翻訳がありません`,
  unitBadStatus: (p: { id: string }) => `翻訳ユニット ${p.id} の status が無効です`,
  unitBadAlignment: (p: { id: string }) => `翻訳ユニット ${p.id} の alignment が無効です`,
  unitAlignmentFields: (p: { id: string }) => `翻訳ユニット ${p.id} の alignment にフィールドが不足しています`,
  unitHashMismatch: (p: { id: string }) => `翻訳ユニット ${p.id} の textHash が翻訳と一致しません`,
  unitExtraFields: (p: { id: string; fields: string }) => `翻訳ユニット ${p.id} に §5.3 にないフィールドがあります：${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `本文に §5.3 にないフィールドがあります：${p.fields}`,
};
