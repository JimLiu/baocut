import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './translation-glossary.zh-Hans.ts';
import { zhHant } from './translation-glossary.zh-Hant.ts';
import { ja } from './translation-glossary.ja.ts';
import { ko } from './translation-glossary.ko.ts';
import { es } from './translation-glossary.es.ts';
import { fr } from './translation-glossary.fr.ts';
import { de } from './translation-glossary.de.ts';
import { nl } from './translation-glossary.nl.ts';
import { ptBR } from './translation-glossary.pt-BR.ts';
import { it } from './translation-glossary.it.ts';
import { ru } from './translation-glossary.ru.ts';
import { pl } from './translation-glossary.pl.ts';
import { tr } from './translation-glossary.tr.ts';
import { vi } from './translation-glossary.vi.ts';

/** `packages/jobs/src/pipelines/translation-glossary.ts`：翻译用术语表的解析与校验。 */
const en = {
  serviceClient: "Service clients can't use glossaries from the user library",
  noLibrary: "This Runtime has no user library, so library glossaries can't be used",
  duplicate: (p: { id: string }) => `Glossary ${p.id} appears twice in glossaries`,
  transcriptionGlossary: (p: { name: string }) => `"${p.name}" is a transcription glossary and can't be used for translation`,
  languageMismatch: (p: { name: string; source: string; target: string }) =>
    `"${p.name}" is a ${p.source} → ${p.target} glossary, which doesn't match the languages of this translation`,
  languageMismatchAnySource: (p: { name: string; target: string }) =>
    `"${p.name}" is an any language → ${p.target} glossary, which doesn't match the languages of this translation`,
  refMalformed: 'glossaryRef has the wrong shape',
  refIncompleteEntry: 'glossaryRef.entries contains an incomplete entry',
  refIncompleteTerm: 'glossaryRef.terms contains an incomplete term',
};

export type JobsTranslationGlossaryMessages = typeof en;

export const JobsTranslationGlossary = defineCatalog('jobsTranslationGlossary', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
