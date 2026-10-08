import type { JobsTranslationBatchesMessages } from './translation-batches.ts';

export const ru: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: "Каждый элемент параметра glossary требует непустые source и target",
  glossaryNoteInvalid: "note в параметре glossary должен быть строкой",
  glossariesItemInvalid: "Каждый элемент параметра glossaries требует id глоссария",
  glossariesUnknownFields: (p: { fields: string }) => `Элементы параметра glossaries содержат неизвестные поля: ${p.fields}`,
  glossariesVersionInvalid: "version в параметре glossaries должен быть положительным целым числом",
  cannotFreezeGlossaries: "Этот Runtime не может зафиксировать содержимое глоссария",
  artifactGone: (p: { artifactId: string }) => `Результат ${p.artifactId} больше не существует`,
  batchFailedSentences: (p: { first: number; last: number; retries: number }) => `Перевод предложений ${p.first}–${p.last} всё ещё не соответствует ожидаемому формату; число повторных попыток: ${p.retries}`,
  batchFailedCues: (p: { first: number; last: number; retries: number }) => `Перевод субтитров ${p.first}–${p.last} всё ещё не соответствует ожидаемому формату; число повторных попыток: ${p.retries}`,
  outputNoTranslations: "В результате нет переводов",
  outputCountMismatch: (p: { output: number; input: number }) => `Число элементов результата: ${p.output}; число предложений на входе: ${p.input}`,
  outputIncompleteItem: "В результате есть элементы без id или перевода",
  outputDuplicateId: (p: { id: string }) => `${p.id} встречается в результате дважды`,
  outputMissingIds: (p: { ids: string }) => `В результате отсутствует ${p.ids}`,
};
