import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './dub-separator.zh-Hans.ts';
import { zhHant } from './dub-separator.zh-Hant.ts';
import { ja } from './dub-separator.ja.ts';
import { ko } from './dub-separator.ko.ts';
import { es } from './dub-separator.es.ts';
import { fr } from './dub-separator.fr.ts';
import { de } from './dub-separator.de.ts';
import { nl } from './dub-separator.nl.ts';
import { ptBR } from './dub-separator.pt-BR.ts';
import { it } from './dub-separator.it.ts';
import { ru } from './dub-separator.ru.ts';
import { pl } from './dub-separator.pl.ts';
import { tr } from './dub-separator.tr.ts';
import { vi } from './dub-separator.vi.ts';

/** `packages/jobs/src/pipelines/dub-separator.ts`：本机人声与背景分离的错误。 */
const en = {
  noAudio: "The asset has no audio track, so it can't be separated",
  unreadable: "Couldn't read the asset",
};

export type JobsDubSeparatorMessages = typeof en;

export const JobsDubSeparator = defineCatalog('jobsDubSeparator', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
