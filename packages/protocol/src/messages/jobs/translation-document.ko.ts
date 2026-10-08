import type { JobsTranslationDocumentMessages } from './translation-document.ts';

export const ko: JobsTranslationDocumentMessages = {
  notSpeech: '원본 문서가 baocut.speech/1 전사본이 아닙니다',
  unreadable: '전사본을 읽지 못했습니다',
  notObject: '본문이 객체가 아닙니다',
  schemaShouldBe: (p: { schema: string }) => `schema는 ${p.schema} 형식이어야 합니다`,
  missingLanguage: 'language 항목이 없습니다',
  basisMismatch: 'sourceBasis가 고정된 원본과 일치하지 않습니다',
  basisDerivationMismatch:
    'sourceBasis의 sequence나 editViewHash가 고정된 원본과 일치하지 않습니다(문장이 같은 규칙으로 도출되지 않았습니다)',
  missingUnits: 'units 항목이 없습니다',
  unitCountMismatch: (p: { units: number; sentences: number }) =>
    `번역 단위는 ${p.units}개이지만 원본 문장은 ${p.sentences}개입니다`,
  unitDuplicate: (p: { id: string }) => `${p.id} 번역 단위가 중복되었습니다`,
  unitSentenceMismatch: (p: { n: number }) => `${p.n}번째 번역 단위가 원본 문장과 일치하지 않습니다`,
  unitMissingSource: (p: { n: number }) => `${p.n}번째 번역 단위에 원본 문장이나 지문이 없습니다`,
  unitNoText: (p: { id: string }) => `${p.id} 번역 단위에 번역이 없습니다`,
  unitBadStatus: (p: { id: string }) => `${p.id} 번역 단위의 상태가 올바르지 않습니다`,
  unitBadAlignment: (p: { id: string }) => `${p.id} 번역 단위의 정렬이 올바르지 않습니다`,
  unitAlignmentFields: (p: { id: string }) => `${p.id} 번역 단위의 정렬에 필드가 빠져 있습니다`,
  unitHashMismatch: (p: { id: string }) => `${p.id} 번역 단위의 textHash가 번역과 일치하지 않습니다`,
  unitExtraFields: (p: { id: string; fields: string }) => `${p.id} 번역 단위에 §5.3 밖의 필드가 있습니다: ${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `본문에 §5.3 밖의 필드가 있습니다: ${p.fields}`,
};
