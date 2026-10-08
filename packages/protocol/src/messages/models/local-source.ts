import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './local-source.zh-Hans.ts';
import { zhHant } from './local-source.zh-Hant.ts';
import { ja } from './local-source.ja.ts';
import { ko } from './local-source.ko.ts';
import { es } from './local-source.es.ts';
import { fr } from './local-source.fr.ts';
import { de } from './local-source.de.ts';
import { nl } from './local-source.nl.ts';
import { ptBR } from './local-source.pt-BR.ts';
import { it } from './local-source.it.ts';
import { ru } from './local-source.ru.ts';
import { pl } from './local-source.pl.ts';
import { tr } from './local-source.tr.ts';
import { vi } from './local-source.vi.ts';

/** `packages/models/src/local-source.ts` 给人看的文字：本机 Provider 的名字。 */
const en = {
  localLabel: 'This computer',
};

export type ModelsLocalSourceMessages = typeof en;

export const ModelsLocalSource = defineCatalog('modelsLocalSource', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
