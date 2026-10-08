import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './translation-batches.zh-Hans.ts';
import { zhHant } from './translation-batches.zh-Hant.ts';
import { ja } from './translation-batches.ja.ts';
import { ko } from './translation-batches.ko.ts';
import { es } from './translation-batches.es.ts';
import { fr } from './translation-batches.fr.ts';
import { de } from './translation-batches.de.ts';
import { nl } from './translation-batches.nl.ts';
import { ptBR } from './translation-batches.pt-BR.ts';
import { it } from './translation-batches.it.ts';
import { ru } from './translation-batches.ru.ts';
import { pl } from './translation-batches.pl.ts';
import { tr } from './translation-batches.tr.ts';
import { vi } from './translation-batches.vi.ts';

/** `packages/jobs/src/pipelines/translation-batches.ts`：逐批翻译、术语表参数与产物读取的错误。 */
const en = {
  glossaryItemInvalid: 'Each item of parameter glossary needs a non-empty source and target',
  glossaryNoteInvalid: 'The note in parameter glossary should be a string',
  glossariesItemInvalid: 'Each item of parameter glossaries needs a glossary id',
  glossariesUnknownFields: (p: { fields: string }) => `Items of parameter glossaries have unknown fields: ${p.fields}`,
  glossariesVersionInvalid: 'The version in parameter glossaries should be a positive integer',
  cannotFreezeGlossaries: "This Runtime can't freeze glossary contents",
  artifactGone: (p: { artifactId: string }) => `Output ${p.artifactId} no longer exists`,
  batchFailedSentences: (p: { first: number; last: number; retries: number }) =>
    `The translation of sentences ${p.first}–${p.last} still didn't match the expected format after ${p.retries} retries`,
  batchFailedCues: (p: { first: number; last: number; retries: number }) =>
    `The translation of subtitles ${p.first}–${p.last} still didn't match the expected format after ${p.retries} retries`,
  outputNoTranslations: 'The output has no translations',
  outputCountMismatch: (p: { output: number; input: number }) => `The output has ${p.output} items; the input has ${p.input} sentences`,
  outputIncompleteItem: 'The output has items missing an id or translation',
  outputDuplicateId: (p: { id: string }) => `${p.id} appears twice in the output`,
  outputMissingIds: (p: { ids: string }) => `The output is missing ${p.ids}`,
};

export type JobsTranslationBatchesMessages = typeof en;

export const JobsTranslationBatches = defineCatalog('jobsTranslationBatches', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
