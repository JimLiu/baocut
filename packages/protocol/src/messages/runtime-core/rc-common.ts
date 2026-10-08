import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-common.zh-Hans.ts';
import { zhHant } from './rc-common.zh-Hant.ts';
import { ja } from './rc-common.ja.ts';
import { ko } from './rc-common.ko.ts';
import { es } from './rc-common.es.ts';
import { fr } from './rc-common.fr.ts';
import { de } from './rc-common.de.ts';
import { nl } from './rc-common.nl.ts';
import { ptBR } from './rc-common.pt-BR.ts';
import { it } from './rc-common.it.ts';
import { ru } from './rc-common.ru.ts';
import { pl } from './rc-common.pl.ts';
import { tr } from './rc-common.tr.ts';
import { vi } from './rc-common.vi.ts';

/** runtime-core 各处共用的短句。英文是键与类型的来源，译文在 `rc-common.<语言>.ts`。 */
const en = {
  cancelled: 'Cancelled',
  videoNotOpen: "The video isn't open",
};

export type RcCommonMessages = typeof en;

export const RcCommon = defineCatalog('rcCommon', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
