import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './translation-document.zh-Hans.ts';
import { zhHant } from './translation-document.zh-Hant.ts';
import { ja } from './translation-document.ja.ts';
import { ko } from './translation-document.ko.ts';
import { es } from './translation-document.es.ts';
import { fr } from './translation-document.fr.ts';
import { de } from './translation-document.de.ts';
import { nl } from './translation-document.nl.ts';
import { ptBR } from './translation-document.pt-BR.ts';
import { it } from './translation-document.it.ts';
import { ru } from './translation-document.ru.ts';
import { pl } from './translation-document.pl.ts';
import { tr } from './translation-document.tr.ts';
import { vi } from './translation-document.vi.ts';

/** `packages/jobs/src/pipelines/translation-document.ts`：读原文句子与校验译文正文时的问题。 */
const en = {
  notSpeech: 'The source document is not a baocut.speech/1 transcript',
  unreadable: "Couldn't read the transcript",
  notObject: 'The body is not an object',
  schemaShouldBe: (p: { schema: string }) => `schema should be ${p.schema}`,
  missingLanguage: 'language is missing',
  basisMismatch: "sourceBasis doesn't match the frozen source",
  basisDerivationMismatch:
    "The sequence or editViewHash in sourceBasis doesn't match the frozen source (the sentences weren't derived by the same rules)",
  missingUnits: 'units is missing',
  unitCountMismatch: (p: { units: number; sentences: number }) =>
    `There are ${p.units} translation units, but the source has ${p.sentences} sentences`,
  unitDuplicate: (p: { id: string }) => `Translation unit ${p.id} is duplicated`,
  unitSentenceMismatch: (p: { n: number }) => `Translation unit ${p.n} doesn't match its source sentence`,
  unitMissingSource: (p: { n: number }) => `Translation unit ${p.n} is missing its source sentence or fingerprint`,
  unitNoText: (p: { id: string }) => `Translation unit ${p.id} has no translation`,
  unitBadStatus: (p: { id: string }) => `Translation unit ${p.id} has an invalid status`,
  unitBadAlignment: (p: { id: string }) => `Translation unit ${p.id} has an invalid alignment`,
  unitAlignmentFields: (p: { id: string }) => `The alignment of translation unit ${p.id} is missing fields`,
  unitHashMismatch: (p: { id: string }) => `The textHash of translation unit ${p.id} doesn't match the translation`,
  unitExtraFields: (p: { id: string; fields: string }) => `Translation unit ${p.id} has fields outside §5.3: ${p.fields}`,
  bodyExtraFields: (p: { fields: string }) => `The body has fields outside §5.3: ${p.fields}`,
};

export type JobsTranslationDocumentMessages = typeof en;

export const JobsTranslationDocument = defineCatalog('jobsTranslationDocument', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
