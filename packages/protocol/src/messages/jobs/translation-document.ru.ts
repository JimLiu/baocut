import type { JobsTranslationDocumentMessages } from './translation-document.ts';

export const ru: JobsTranslationDocumentMessages = {
  notSpeech: "Исходный документ не является расшифровкой baocut.speech/1",
  unreadable: "Не удалось прочитать расшифровку",
  notObject: "Тело не является объектом",
  schemaShouldBe: (p: { schema: string }) => `schema должна быть ${p.schema}`,
  missingLanguage: "Отсутствует language",
  basisMismatch: "sourceBasis не совпадает с зафиксированным источником",
  basisDerivationMismatch: "sequence или editViewHash в sourceBasis не совпадает с зафиксированным источником (предложения получены по другим правилам)",
  missingUnits: "Отсутствует units",
  unitCountMismatch: (p: { units: number; sentences: number }) => `Число ${p.units} единиц перевода, а число предложений источника: ${p.sentences}`,
  unitDuplicate: (p: { id: string }) => `Единица перевода ${p.id} дублируется`,
  unitSentenceMismatch: (p: { n: number }) => `Единица перевода ${p.n} не совпадает с исходным предложением`,
  unitMissingSource: (p: { n: number }) => `Единица перевода ${p.n} не содержит исходного предложения или fingerprint`,
  unitNoText: (p: { id: string }) => `Единица перевода ${p.id} не содержит перевода`,
  unitBadStatus: (p: { id: string }) => `Единица перевода ${p.id} имеет недопустимый статус`,
  unitBadAlignment: (p: { id: string }) => `Единица перевода ${p.id} имеет недопустимое alignment`,
  unitAlignmentFields: (p: { id: string }) => `alignment единицы перевода ${p.id} не содержит полей`,
  unitHashMismatch: (p: { id: string }) => `textHash единицы перевода ${p.id} не совпадает с переводом`,
  unitExtraFields: (p: { id: string; fields: string }) => `Единица перевода ${p.id} содержит поля вне §5.3: ${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `Тело содержит поля вне §5.3: ${p.fields}`,
};
