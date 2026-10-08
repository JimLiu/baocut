import type { JobsTranslationDocumentMessages } from './translation-document.ts';

export const nl: JobsTranslationDocumentMessages = {
  notSpeech: "Het brondocument is geen baocut.speech/1-transcript",
  unreadable: "Kan het transcript niet lezen",
  notObject: "De inhoud is geen object",
  schemaShouldBe: (p: { schema: string }) => `schema moet zijn: ${p.schema}`,
  missingLanguage: "language ontbreekt",
  basisMismatch: "sourceBasis komt niet overeen met de bevroren bron",
  basisDerivationMismatch:
    "sequence of editViewHash in sourceBasis komt niet overeen met de bevroren bron (de zinnen zijn niet afgeleid volgens dezelfde regels)",
  missingUnits: "units ontbreekt",
  unitCountMismatch: (p: { units: number; sentences: number }) =>
    `Er zijn ${p.units} vertaaleenheden, maar de bron bevat ${p.sentences} zinnen`,
  unitDuplicate: (p: { id: string }) => `Vertaaleenheid ${p.id} is gedupliceerd`,
  unitSentenceMismatch: (p: { n: number }) => `Vertaaleenheid ${p.n} komt niet overeen met de bronzin`,
  unitMissingSource: (p: { n: number }) => `Vertaaleenheid ${p.n} mist de bronzin of fingerprint`,
  unitNoText: (p: { id: string }) => `Vertaaleenheid ${p.id} heeft geen vertaling`,
  unitBadStatus: (p: { id: string }) => `Vertaaleenheid ${p.id} heeft een ongeldige status`,
  unitBadAlignment: (p: { id: string }) => `Vertaaleenheid ${p.id} heeft een ongeldige uitlijning`,
  unitAlignmentFields: (p: { id: string }) => `De uitlijning van vertaaleenheid ${p.id} mist velden`,
  unitHashMismatch: (p: { id: string }) => `De textHash van vertaaleenheid ${p.id} komt niet overeen met de vertaling`,
  unitExtraFields: (p: { id: string; fields: string }) => `Vertaaleenheid ${p.id} bevat velden buiten §5.3: ${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `De inhoud bevat velden buiten §5.3: ${p.fields}`,
};
