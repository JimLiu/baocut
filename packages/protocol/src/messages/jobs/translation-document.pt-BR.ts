import type { JobsTranslationDocumentMessages } from './translation-document.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: JobsTranslationDocumentMessages = {
  notSpeech: "O documento de origem não é uma transcrição baocut.speech/1",
  unreadable: "Não foi possível ler a transcrição",
  notObject: "O corpo não é um objeto",
  schemaShouldBe: (p: { schema: string }) => `schema deve ser ${p.schema}`,
  missingLanguage: "language está ausente",
  basisMismatch: "sourceBasis não corresponde à origem congelada",
  basisDerivationMismatch: "A sequência ou editViewHash de sourceBasis não corresponde à origem congelada (as frases não foram derivadas pelas mesmas regras)",
  missingUnits: "units está ausente",
  unitCountMismatch: (p: { units: number; sentences: number }) => `Há ${pluralForm('pt-BR', p.units, { one: `${p.units} unidade de tradução`, other: `${p.units} unidades de tradução` })}, mas a origem tem ${pluralForm('pt-BR', p.sentences, { one: `${p.sentences} frase`, other: `${p.sentences} frases` })}`,
  unitDuplicate: (p: { id: string }) => `A unidade de tradução ${p.id} está duplicada`,
  unitSentenceMismatch: (p: { n: number }) => `A unidade de tradução ${p.n} não corresponde à sua frase de origem`,
  unitMissingSource: (p: { n: number }) => `A unidade de tradução ${p.n} não tem a frase de origem ou a impressão digital`,
  unitNoText: (p: { id: string }) => `A unidade de tradução ${p.id} não tem tradução`,
  unitBadStatus: (p: { id: string }) => `A unidade de tradução ${p.id} tem status inválido`,
  unitBadAlignment: (p: { id: string }) => `A unidade de tradução ${p.id} tem alignment inválido`,
  unitAlignmentFields: (p: { id: string }) => `A unidade de tradução ${p.id} tem campos ausentes em alignment`,
  unitHashMismatch: (p: { id: string }) => `A unidade de tradução ${p.id} tem textHash que não corresponde à tradução`,
  unitExtraFields: (p: { id: string; fields: string }) => `A unidade de tradução ${p.id} tem campos fora de §5.3: ${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `O corpo tem campos fora de §5.3: ${p.fields}`,
};
