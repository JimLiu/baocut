import type { JobsTranslationDocumentMessages } from './translation-document.ts';

export const fr: JobsTranslationDocumentMessages = {
  notSpeech: "Le document source n’est pas une transcription baocut.speech/1",
  unreadable: "Impossible de lire la transcription",
  notObject: "Le contenu n’est pas un objet",
  schemaShouldBe: (p: { schema: string }) => `schema doit être ${p.schema}`,
  missingLanguage: "language est manquant",
  basisMismatch: "sourceBasis ne correspond pas à la source figée",
  basisDerivationMismatch:
    "sequence ou editViewHash de sourceBasis ne correspond pas à la source figée (phrases dérivées selon des règles différentes)",
  missingUnits: "units est manquant",
  unitCountMismatch: (p: { units: number; sentences: number }) =>
    `Il y a ${p.units} unités de traduction, mais la source contient ${p.sentences} phrases`,
  unitDuplicate: (p: { id: string }) => `L’unité de traduction ${p.id} est dupliquée`,
  unitSentenceMismatch: (p: { n: number }) => `L’unité de traduction ${p.n} ne correspond pas à sa phrase source`,
  unitMissingSource: (p: { n: number }) => `L’unité de traduction ${p.n} n’a pas de phrase source ou d’empreinte`,
  unitNoText: (p: { id: string }) => `L’unité de traduction ${p.id} n’a aucune traduction`,
  unitBadStatus: (p: { id: string }) => `L’unité de traduction ${p.id} a un état invalide`,
  unitBadAlignment: (p: { id: string }) => `L’unité de traduction ${p.id} a un alignement invalide`,
  unitAlignmentFields: (p: { id: string }) => `L’alignement de l’unité de traduction ${p.id} a des champs manquants`,
  unitHashMismatch: (p: { id: string }) => `Le textHash de l’unité de traduction ${p.id} ne correspond pas à la traduction`,
  unitExtraFields: (p: { id: string; fields: string }) => `L’unité de traduction ${p.id} a des champs hors §5.3 : ${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `Le contenu a des champs hors §5.3 : ${p.fields}`,
};
