import { defineMessages } from '@baocut/protocol';
import { zhHans } from './sticker-pack-copy.zh-Hans.ts';
import { zhHant } from './sticker-pack-copy.zh-Hant.ts';
import { ja } from './sticker-pack-copy.ja.ts';
import { ko } from './sticker-pack-copy.ko.ts';
import { es } from './sticker-pack-copy.es.ts';
import { fr } from './sticker-pack-copy.fr.ts';
import { de } from './sticker-pack-copy.de.ts';
import { nl } from './sticker-pack-copy.nl.ts';
import { ptBR } from './sticker-pack-copy.pt-BR.ts';
import { it } from './sticker-pack-copy.it.ts';
import { ru } from './sticker-pack-copy.ru.ts';
import { pl } from './sticker-pack-copy.pl.ts';
import { tr } from './sticker-pack-copy.tr.ts';
import { vi } from './sticker-pack-copy.vi.ts';

/** 随包贴纸（`@baocut/protocol` 的 `sticker-packs.ts`）的包名，与元素面板里讲这些包的几句。译文在 `sticker-pack-copy.zh-Hans.ts`。 */
const en = {
  packs: {
    featured: 'Featured',
    emoji: 'Emoji',
    people: 'People',
    mockup: 'Mockups',
    podcast: 'Podcast',
    icon: 'Icons',
    summer: 'Summer',
    gesture: 'Gestures',
    arrow: 'Arrows & pointers',
    hand: 'Hand-drawn',
    birthday: 'Happy birthday',
    finance: 'Finance',
    fitness: 'Fitness',
    seasonal: 'Seasonal',
    school: 'Back to school',
    cta: 'CTA',
    'dyn-collage': 'Collage',
    'dyn-emoji': 'Emoji',
    'dyn-grow': 'Growth',
    'dyn-holiday': 'Holiday',
    'dyn-work': 'Work',
  } as Record<string, string>,
  morePacks: 'More packs',
  packMenuHead: (count: number) => `${count} packs`,
  packCount: (count: number) => `${count} stickers`,
  ctaTitle: 'CTA pop-ups',
  ctaNote: '32 styles · subscribe / like / share / buy',
  notoHint:
    'The five built-in categories are Google Noto Animated Emoji (CC BY 4.0): vector Lottie loops with transparency that follow the playhead on the canvas and can be recolored like stickers.',
  addFailed: (message: string) => `Couldn’t add the sticker: ${message}`,
};

export type StickerPackMessages = typeof en;
export const STICKER_PACK_COPY = defineMessages(en, {
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ja,
  ko,
  es,
  fr,
  de,
  nl,
  'pt-BR': ptBR,
  it,
  ru,
  pl,
  tr,
  vi,
});
