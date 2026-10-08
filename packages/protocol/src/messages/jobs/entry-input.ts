import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './entry-input.zh-Hans.ts';
import { zhHant } from './entry-input.zh-Hant.ts';
import { ja } from './entry-input.ja.ts';
import { ko } from './entry-input.ko.ts';
import { es } from './entry-input.es.ts';
import { fr } from './entry-input.fr.ts';
import { de } from './entry-input.de.ts';
import { nl } from './entry-input.nl.ts';
import { ptBR } from './entry-input.pt-BR.ts';
import { it } from './entry-input.it.ts';
import { ru } from './entry-input.ru.ts';
import { pl } from './entry-input.pl.ts';
import { tr } from './entry-input.tr.ts';
import { vi } from './entry-input.vi.ts';

/** `packages/jobs/src/pipelines/entry-input.ts` 给人看的文字。 */
const en = {
  unresolvedEntry: 'is a Space entry; submit it through pipelines.start so the Runtime replaces it with a file path',
};

export type JobsEntryInputMessages = typeof en;

export const JobsEntryInput = defineCatalog('jobsEntryInput', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
