import { defineMessages } from '@baocut/protocol';
import { zhHans } from './transition-panel-copy.zh-Hans.ts';
import { zhHant } from './transition-panel-copy.zh-Hant.ts';
import { ja } from './transition-panel-copy.ja.ts';
import { ko } from './transition-panel-copy.ko.ts';
import { es } from './transition-panel-copy.es.ts';
import { fr } from './transition-panel-copy.fr.ts';
import { de } from './transition-panel-copy.de.ts';
import { nl } from './transition-panel-copy.nl.ts';
import { ptBR } from './transition-panel-copy.pt-BR.ts';
import { it } from './transition-panel-copy.it.ts';
import { ru } from './transition-panel-copy.ru.ts';
import { pl } from './transition-panel-copy.pl.ts';
import { tr } from './transition-panel-copy.tr.ts';
import { vi } from './transition-panel-copy.vi.ts';

/** 属性页「转场」一节的文案（model/transition-panel.ts；译文在 `transition-panel-copy.<语言>.ts`）。 */
const en = {
  slot: { in: 'In', out: 'Out' },
  choice: {
    none: 'None',
    dissolve: 'Dissolve',
    wipe: 'Wipe',
    slide: 'Slide in',
    zoom: 'Zoom',
    'dip-to-color': 'Dip to color',
    push: 'Push',
  },
  direction: { right: 'Right', left: 'Left', down: 'Down', up: 'Up' },
  easing: { linear: 'Linear', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in and out' },
};
export type TransitionPanelMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
