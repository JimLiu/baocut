import type { JobsTranslationBatchesMessages } from './translation-batches.ts';

export const nl: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: "Elk item van parameter glossary vereist een niet-lege source en target",
  glossaryNoteInvalid: "De note in parameter glossary moet een tekenreeks zijn",
  glossariesItemInvalid: "Elk item van parameter glossaries vereist een woordenlijst-ID",
  glossariesUnknownFields: (p: { fields: string }) => `Items van parameter glossaries bevatten onbekende velden: ${p.fields}`,
  glossariesVersionInvalid: "De version in parameter glossaries moet een positief geheel getal zijn",
  cannotFreezeGlossaries: "Deze Runtime kan de inhoud van woordenlijsten niet bevriezen",
  artifactGone: (p: { artifactId: string }) => `Uitvoer ${p.artifactId} bestaat niet meer`,
  batchFailedSentences: (p: { first: number; last: number; retries: number }) =>
    `De vertaling van zinnen ${p.first}–${p.last} voldeed nog niet aan het verwachte formaat na ${p.retries} nieuwe pogingen`,
  batchFailedCues: (p: { first: number; last: number; retries: number }) =>
    `De vertaling van ondertitels ${p.first}–${p.last} voldeed nog niet aan het verwachte formaat na ${p.retries} nieuwe pogingen`,
  outputNoTranslations: "De uitvoer bevat geen vertalingen",
  outputCountMismatch: (p: { output: number; input: number }) => `De uitvoer bevat ${p.output} items; de invoer bevat ${p.input} zinnen`,
  outputIncompleteItem: "De uitvoer bevat items zonder id of translation",
  outputDuplicateId: (p: { id: string }) => `${p.id} staat twee keer in de uitvoer`,
  outputMissingIds: (p: { ids: string }) => `In de uitvoer ontbreekt ${p.ids}`,
};
