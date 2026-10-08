import type { JobsTranslationDocumentMessages } from './translation-document.ts';

export const pl: JobsTranslationDocumentMessages = {
  notSpeech: "Dokument źródłowy nie jest transkrypcją baocut.speech/1",
  unreadable: "Nie udało się odczytać transkrypcji",
  notObject: "Treść nie jest obiektem",
  schemaShouldBe: (p: { schema: string }) => `schema musi być ${p.schema}`,
  missingLanguage: "Brak language",
  basisMismatch: "sourceBasis nie odpowiada utrwalonemu źródłu",
  basisDerivationMismatch: "sequence lub editViewHash w sourceBasis nie odpowiada utrwalonemu źródłu (zdania uzyskano według innych reguł)",
  missingUnits: "Brak units",
  unitCountMismatch: (p: { units: number; sentences: number }) => `Liczba ${p.units} jednostek tłumaczenia, a liczba zdań źródła: ${p.sentences}`,
  unitDuplicate: (p: { id: string }) => `Jednostka tłumaczenia ${p.id} jest zduplikowana`,
  unitSentenceMismatch: (p: { n: number }) => `Jednostka tłumaczenia ${p.n} nie odpowiada zdaniu źródłowemu`,
  unitMissingSource: (p: { n: number }) => `Jednostka tłumaczenia ${p.n} nie zawiera zdania źródłowego lub fingerprint`,
  unitNoText: (p: { id: string }) => `Jednostka tłumaczenia ${p.id} nie zawiera tłumaczenia`,
  unitBadStatus: (p: { id: string }) => `Jednostka tłumaczenia ${p.id} ma nieprawidłowy stan`,
  unitBadAlignment: (p: { id: string }) => `Jednostka tłumaczenia ${p.id} ma nieprawidłowe alignment`,
  unitAlignmentFields: (p: { id: string }) => `alignment jednostki tłumaczenia ${p.id} nie zawiera pól`,
  unitHashMismatch: (p: { id: string }) => `textHash jednostki tłumaczenia ${p.id} nie odpowiada tłumaczeniu`,
  unitExtraFields: (p: { id: string; fields: string }) => `Jednostka tłumaczenia ${p.id} zawiera pola spoza §5.3: ${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `Treść zawiera pola spoza §5.3: ${p.fields}`,
};
