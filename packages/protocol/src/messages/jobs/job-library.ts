import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './job-library.zh-Hans.ts';
import { zhHant } from './job-library.zh-Hant.ts';
import { ja } from './job-library.ja.ts';
import { ko } from './job-library.ko.ts';
import { es } from './job-library.es.ts';
import { fr } from './job-library.fr.ts';
import { de } from './job-library.de.ts';
import { nl } from './job-library.nl.ts';
import { ptBR } from './job-library.pt-BR.ts';
import { it } from './job-library.it.ts';
import { ru } from './job-library.ru.ts';
import { pl } from './job-library.pl.ts';
import { tr } from './job-library.tr.ts';
import { vi } from './job-library.vi.ts';

/** `packages/jobs/src/job-library.ts`：任务引用用户库条目时的拒绝。 */
const en = {
  serviceNoGlossaries: "Clients of external services can't use glossaries from the user library",
  serviceNoVoices: "Clients of external services can't use voices from the user library",
  noLibraryForGlossaries: "This Runtime has no user library, so glossaries can't be used",
  noLibraryForVoices: "This Runtime has no user library, so library voices can't be used",
  translationGlossary: (p: { name: string }) => `"${p.name}" is a translation glossary and can't be used for transcription`,
};

export type JobsLibraryMessages = typeof en;

export const JobsLibrary = defineCatalog('jobsLibrary', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
