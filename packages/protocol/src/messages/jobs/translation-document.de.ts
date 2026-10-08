import type { JobsTranslationDocumentMessages } from './translation-document.ts';

export const de: JobsTranslationDocumentMessages = {
  notSpeech: "Das Quelldokument ist kein baocut.speech/1-Transkript",
  unreadable: "Transkript konnte nicht gelesen werden",
  notObject: "Der Inhalt ist kein Objekt",
  schemaShouldBe: (p: { schema: string }) => `schema muss sein: ${p.schema}`,
  missingLanguage: "language fehlt",
  basisMismatch: "sourceBasis stimmt nicht mit der eingefrorenen Quelle überein",
  basisDerivationMismatch:
    "sequence oder editViewHash in sourceBasis stimmt nicht mit der eingefrorenen Quelle überein (die Sätze wurden nicht nach denselben Regeln abgeleitet)",
  missingUnits: "units fehlt",
  unitCountMismatch: (p: { units: number; sentences: number }) =>
    `Es gibt ${p.units} Übersetzungseinheiten; die Quelle enthält jedoch ${p.sentences} Sätze`,
  unitDuplicate: (p: { id: string }) => `Übersetzungseinheit ${p.id} ist doppelt vorhanden`,
  unitSentenceMismatch: (p: { n: number }) => `Übersetzungseinheit ${p.n} stimmt nicht mit dem Quellsatz überein`,
  unitMissingSource: (p: { n: number }) => `Übersetzungseinheit ${p.n} enthält keinen Quellsatz oder Fingerprint`,
  unitNoText: (p: { id: string }) => `Übersetzungseinheit ${p.id} hat keine Übersetzung`,
  unitBadStatus: (p: { id: string }) => `Übersetzungseinheit ${p.id} hat einen ungültigen Status`,
  unitBadAlignment: (p: { id: string }) => `Übersetzungseinheit ${p.id} hat eine ungültige Ausrichtung`,
  unitAlignmentFields: (p: { id: string }) => `Die Ausrichtung der Übersetzungseinheit ${p.id} enthält nicht alle Felder`,
  unitHashMismatch: (p: { id: string }) => `Der textHash der Übersetzungseinheit ${p.id} stimmt nicht mit der Übersetzung überein`,
  unitExtraFields: (p: { id: string; fields: string }) => `Übersetzungseinheit ${p.id} enthält Felder außerhalb von §5.3: ${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `Der Inhalt enthält Felder außerhalb von §5.3: ${p.fields}`,
};
