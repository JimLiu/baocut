import { defineMessages } from '@baocut/protocol';
import { zhHans } from './render-copy.zh-Hans.ts';
import { zhHant } from './render-copy.zh-Hant.ts';
import { ja } from './render-copy.ja.ts';
import { ko } from './render-copy.ko.ts';
import { es } from './render-copy.es.ts';
import { fr } from './render-copy.fr.ts';
import { de } from './render-copy.de.ts';
import { nl } from './render-copy.nl.ts';
import { ptBR } from './render-copy.pt-BR.ts';
import { it } from './render-copy.it.ts';
import { ru } from './render-copy.ru.ts';
import { pl } from './render-copy.pl.ts';
import { tr } from './render-copy.tr.ts';
import { vi } from './render-copy.vi.ts';

/** 预览渲染（彩纸的款名与形状名、帧计划器与字体载入的报错）的文案。英文写在这里，译文在 `render-copy.zh-Hans.ts`。 */
const en = {
  confetti: {
    shapes: {
      rect: 'Paper',
      strip: 'Strip',
      circle: 'Dot',
      ellipse: 'Ellipse',
      triangle: 'Triangle',
      diamond: 'Diamond',
      star: 'Star',
      starlet: 'Four-point star',
      sparkle: 'Sparkle',
      heart: 'Heart',
      petal: 'Petal',
      ribbon: 'Ribbon',
    },
    styles: {
      'rainbow-paper': 'Rainbow paper',
      'pastel-fall': 'Pastel fall',
      'neon-streamers': 'Neon streamers',
      'golden-starburst': 'Golden starburst',
      'festival-fireworks': 'Festival fireworks',
      'hearts-petals': 'Hearts and petals',
      'party-cannons': 'Party cannons',
      'curling-ribbons': 'Curling ribbons',
      'geometric-pop': 'Geometric pop',
      'champagne-sparkle': 'Champagne sparkle',
    } as Record<string, string>,
  },
  fonts: {
    tableFailed: (status: number) => `Couldn’t fetch a font table: ${status}`,
    tableLength: (expected: number, got: number) => `Font table has the wrong length: expected ${expected} bytes, got ${got}`,
    localMissing: (family: string) => `The local font ${family} is gone`,
    notFound: (name: string) => `Font ${name} not found. Run npm run build:wasm first`,
    unreadable: (name: string, status: number) => `Couldn’t read font ${name} (${status})`,
    unreadableUrl: (url: string) => `Couldn’t read font: ${url}`,
  },
  planner: {
    wasmMissing: 'The preview WASM isn’t available. Run npm run build:wasm first',
    reloading: 'The frame planner is reloading',
    crashed: (message: string) => `The frame planner hit an error and is reloading: ${message}`,
    reloadFailed: 'The frame planner couldn’t reload',
  },
};

export type RenderMessages = typeof en;

export const R = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
