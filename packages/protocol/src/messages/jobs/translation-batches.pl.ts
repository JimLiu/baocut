import type { JobsTranslationBatchesMessages } from './translation-batches.ts';

export const pl: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: "Każdy element parametru glossary wymaga niepustych source i target",
  glossaryNoteInvalid: "note w parametrze glossary musi być ciągiem",
  glossariesItemInvalid: "Każdy element parametru glossaries wymaga id słownika",
  glossariesUnknownFields: (p: { fields: string }) => `Elementy parametru glossaries mają nieznane pola: ${p.fields}`,
  glossariesVersionInvalid: "version w parametrze glossaries musi być dodatnią liczbą całkowitą",
  cannotFreezeGlossaries: "Ten Runtime nie może utrwalić zawartości słownika",
  artifactGone: (p: { artifactId: string }) => `Wynik ${p.artifactId} już nie istnieje`,
  batchFailedSentences: (p: { first: number; last: number; retries: number }) => `Tłumaczenie zdań ${p.first}–${p.last} nadal nie odpowiada oczekiwanemu formatowi; liczba ponownych prób: ${p.retries}`,
  batchFailedCues: (p: { first: number; last: number; retries: number }) => `Tłumaczenie napisów ${p.first}–${p.last} nadal nie odpowiada oczekiwanemu formatowi; liczba ponownych prób: ${p.retries}`,
  outputNoTranslations: "Wynik nie zawiera tłumaczeń",
  outputCountMismatch: (p: { output: number; input: number }) => `Liczba elementów wyniku: ${p.output}; liczba zdań na wejściu: ${p.input}`,
  outputIncompleteItem: "Wynik zawiera elementy bez id lub tłumaczenia",
  outputDuplicateId: (p: { id: string }) => `${p.id} występuje dwukrotnie w wyniku`,
  outputMissingIds: (p: { ids: string }) => `W wyniku brakuje ${p.ids}`,
};
