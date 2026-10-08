import type { JobsTranslationBatchesMessages } from './translation-batches.ts';
import { pluralForm } from '../../i18n.ts';

export const it: JobsTranslationBatchesMessages = {
  glossaryItemInvalid: 'Ogni elemento del parametro glossary richiede source e target non vuoti',
  glossaryNoteInvalid: 'note nel parametro glossary deve essere una stringa',
  glossariesItemInvalid: 'Ogni elemento del parametro glossaries richiede un id di glossario',
  glossariesUnknownFields: (p) => `Gli elementi del parametro glossaries hanno campi sconosciuti: ${p.fields}`,
  glossariesVersionInvalid: 'version nel parametro glossaries deve essere un intero positivo',
  cannotFreezeGlossaries: 'Questo Runtime non può congelare i contenuti dei glossari',
  artifactGone: (p) => `Il risultato ${p.artifactId} non esiste più`,
  batchFailedSentences: (p) => `La traduzione delle frasi ${p.first}–${p.last} non corrisponde ancora al formato previsto dopo ${pluralForm('it', p.retries, { one: `${p.retries} tentativo`, other: `${p.retries} tentativi` })}`,
  batchFailedCues: (p) => `La traduzione dei sottotitoli ${p.first}–${p.last} non corrisponde ancora al formato previsto dopo ${pluralForm('it', p.retries, { one: `${p.retries} tentativo`, other: `${p.retries} tentativi` })}`,
  outputNoTranslations: 'L’output non ha translations',
  outputCountMismatch: (p) => `L’output ha ${pluralForm('it', p.output, { one: `${p.output} elemento`, other: `${p.output} elementi` })}; l’input ha ${pluralForm('it', p.input, { one: `${p.input} frase`, other: `${p.input} frasi` })}`,
  outputIncompleteItem: 'L’output ha elementi privi di id o traduzione',
  outputDuplicateId: (p) => `${p.id} compare due volte nell’output`,
  outputMissingIds: (p) => `L’output non ha ${p.ids}`,
};
