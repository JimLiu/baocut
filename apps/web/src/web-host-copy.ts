import { defineMessages } from '@baocut/protocol';
import { zhHans } from './web-host-copy.zh-Hans.ts';
import { zhHant } from './web-host-copy.zh-Hant.ts';
import { ja } from './web-host-copy.ja.ts';
import { ko } from './web-host-copy.ko.ts';
import { es } from './web-host-copy.es.ts';
import { fr } from './web-host-copy.fr.ts';
import { de } from './web-host-copy.de.ts';
import { nl } from './web-host-copy.nl.ts';
import { ptBR } from './web-host-copy.pt-BR.ts';
import { it } from './web-host-copy.it.ts';
import { ru } from './web-host-copy.ru.ts';
import { pl } from './web-host-copy.pl.ts';
import { tr } from './web-host-copy.tr.ts';
import { vi } from './web-host-copy.vi.ts';

/** 浏览器宿主做不到的事给的提示（web-host.ts）。英文是键与类型的来源，译文在 `web-host-copy.<语言>.ts`。 */
const en = {
  pickDirectory: 'You can’t choose a folder on this computer from the browser. Use the BaoCut desktop app, or open a registered project.',
  pickMedia: 'You can’t import files from this computer in the browser (uploads aren’t supported yet). Use the BaoCut desktop app.',
  dropFiles: 'You can’t drop files from this computer into the browser (uploads aren’t supported yet). Use the BaoCut desktop app.',
  reveal: 'Show in Folder isn’t available in the browser. Use the BaoCut desktop app.',
};

export type WebHostMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
