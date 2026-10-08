import type { JobsTranslationDocumentMessages } from './translation-document.ts';
import { pluralForm } from '../../i18n.ts';

export const it: JobsTranslationDocumentMessages = {
  notSpeech: "Il documento di origine non è una trascrizione baocut.speech/1",
  unreadable: "Impossibile leggere la trascrizione",
  notObject: "Il corpo non è un oggetto",
  schemaShouldBe: (p: { schema: string }) => `schema deve essere ${p.schema}`,
  missingLanguage: "language manca",
  basisMismatch: "sourceBasis non corrisponde all’origine congelata",
  basisDerivationMismatch: "La sequenza o editViewHash in sourceBasis non corrisponde all’origine congelata (le frasi non sono state derivate con le stesse regole)",
  missingUnits: "units manca",
  unitCountMismatch: (p: { units: number; sentences: number }) => `${pluralForm('it', p.units, { one: `C’è ${p.units} unità di traduzione`, other: `Ci sono ${p.units} unità di traduzione` })}, ma l’origine ha ${pluralForm('it', p.sentences, { one: `${p.sentences} frase`, other: `${p.sentences} frasi` })}`,
  unitDuplicate: (p: { id: string }) => `L’unità di traduzione ${p.id} è duplicata`,
  unitSentenceMismatch: (p: { n: number }) => `L’unità di traduzione ${p.n} non corrisponde alla sua frase di origine`,
  unitMissingSource: (p: { n: number }) => `L’unità di traduzione ${p.n} non ha la frase di origine o l’impronta digitale`,
  unitNoText: (p: { id: string }) => `L’unità di traduzione ${p.id} non ha una traduzione`,
  unitBadStatus: (p: { id: string }) => `L’unità di traduzione ${p.id} ha status non valido`,
  unitBadAlignment: (p: { id: string }) => `L’unità di traduzione ${p.id} ha alignment non valido`,
  unitAlignmentFields: (p: { id: string }) => `L’unità di traduzione ${p.id} ha campi mancanti in alignment`,
  unitHashMismatch: (p: { id: string }) => `L’unità di traduzione ${p.id} ha textHash che non corrisponde alla traduzione`,
  unitExtraFields: (p: { id: string; fields: string }) => `L’unità di traduzione ${p.id} ha campi al di fuori di §5.3: ${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `Il corpo ha campi al di fuori di §5.3: ${p.fields}`,
};
