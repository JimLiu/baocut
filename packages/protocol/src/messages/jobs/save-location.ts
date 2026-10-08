import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './save-location.zh-Hans.ts';
import { zhHant } from './save-location.zh-Hant.ts';
import { ja } from './save-location.ja.ts';
import { ko } from './save-location.ko.ts';
import { es } from './save-location.es.ts';
import { fr } from './save-location.fr.ts';
import { de } from './save-location.de.ts';
import { nl } from './save-location.nl.ts';
import { ptBR } from './save-location.pt-BR.ts';
import { it } from './save-location.it.ts';
import { ru } from './save-location.ru.ts';
import { pl } from './save-location.pl.ts';
import { tr } from './save-location.tr.ts';
import { vi } from './save-location.vi.ts';

/** `packages/jobs/src/pipelines/save-location.ts` 给人看的文字。 */
const en = {
  notDirectory: 'Not a folder',
  unwritable: (p: { dir: string; problem: string }) => `Can't write to the save location: ${p.dir} (${p.problem})`,
};

export type JobsSaveLocationMessages = typeof en;

export const JobsSaveLocation = defineCatalog('jobsSaveLocation', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
