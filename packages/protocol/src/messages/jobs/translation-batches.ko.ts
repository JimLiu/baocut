import type { JobsTranslationBatchesMessages } from './translation-batches.ts';

export const ko: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: 'glossary 매개변수의 각 항목에는 비어 있지 않은 source와 target이 필요합니다',
  glossaryNoteInvalid: 'glossary 매개변수의 note는 문자열이어야 합니다',
  glossariesItemInvalid: 'glossaries 매개변수의 각 항목에는 용어집 id가 필요합니다',
  glossariesUnknownFields: (p: { fields: string }) => `glossaries 매개변수의 항목에 알 수 없는 필드가 있습니다: ${p.fields}`,
  glossariesVersionInvalid: 'glossaries 매개변수의 version은 양의 정수여야 합니다',
  cannotFreezeGlossaries: '이 Runtime은 용어집 내용을 고정할 수 없습니다',
  artifactGone: (p: { artifactId: string }) => `${p.artifactId} 결과물이 더 이상 없습니다`,
  batchFailedSentences: (p: { first: number; last: number; retries: number }) =>
    `${p.first}~${p.last}번째 문장의 번역이 ${p.retries}번 다시 시도한 뒤에도 예상 형식과 맞지 않습니다`,
  batchFailedCues: (p: { first: number; last: number; retries: number }) =>
    `${p.first}~${p.last}번째 자막의 번역이 ${p.retries}번 다시 시도한 뒤에도 예상 형식과 맞지 않습니다`,
  outputNoTranslations: '출력에 번역이 없습니다',
  outputCountMismatch: (p: { output: number; input: number }) =>
    `출력 항목은 ${p.output}개이지만 입력 문장은 ${p.input}개입니다`,
  outputIncompleteItem: '출력에 id나 번역이 없는 항목이 있습니다',
  outputDuplicateId: (p: { id: string }) => `출력에 ${p.id} 항목이 두 번 나옵니다`,
  outputMissingIds: (p: { ids: string }) => `출력에 다음 항목이 없습니다: ${p.ids}`,
};
