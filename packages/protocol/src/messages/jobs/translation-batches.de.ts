import type { JobsTranslationBatchesMessages } from './translation-batches.ts';

export const de: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: "Jeder Eintrag des Parameters glossary benötigt nichtleere Werte für source und target",
  glossaryNoteInvalid: "Die note im Parameter glossary muss eine Zeichenfolge sein",
  glossariesItemInvalid: "Jeder Eintrag des Parameters glossaries benötigt eine Glossar-ID",
  glossariesUnknownFields: (p: { fields: string }) => `Einträge des Parameters glossaries enthalten unbekannte Felder: ${p.fields}`,
  glossariesVersionInvalid: "Die version im Parameter glossaries muss eine positive ganze Zahl sein",
  cannotFreezeGlossaries: "Diese Runtime kann Glossarinhalte nicht einfrieren",
  artifactGone: (p: { artifactId: string }) => `Ergebnis ${p.artifactId} ist nicht mehr vorhanden`,
  batchFailedSentences: (p: { first: number; last: number; retries: number }) =>
    `Die Übersetzung der Sätze ${p.first}–${p.last} entsprach auch danach nicht dem erwarteten Format: ${p.retries} erneute Versuche`,
  batchFailedCues: (p: { first: number; last: number; retries: number }) =>
    `Die Übersetzung der Untertitel ${p.first}–${p.last} entsprach auch danach nicht dem erwarteten Format: ${p.retries} erneute Versuche`,
  outputNoTranslations: "Das Ergebnis enthält keine Übersetzungen",
  outputCountMismatch: (p: { output: number; input: number }) => `Das Ergebnis enthält ${p.output} Einträge; die Eingabe enthält ${p.input} Sätze`,
  outputIncompleteItem: "Das Ergebnis enthält Einträge ohne id oder translation",
  outputDuplicateId: (p: { id: string }) => `${p.id} erscheint zweimal im Ergebnis`,
  outputMissingIds: (p: { ids: string }) => `Im Ergebnis fehlt ${p.ids}`,
};
