import { defineMessages } from '@baocut/protocol';
import { zhHans } from './pet-copy.zh-Hans.ts';
import { zhHant } from './pet-copy.zh-Hant.ts';
import { ja } from './pet-copy.ja.ts';
import { ko } from './pet-copy.ko.ts';
import { es } from './pet-copy.es.ts';
import { fr } from './pet-copy.fr.ts';
import { de } from './pet-copy.de.ts';
import { nl } from './pet-copy.nl.ts';
import { ptBR } from './pet-copy.pt-BR.ts';
import { it } from './pet-copy.it.ts';
import { ru } from './pet-copy.ru.ts';
import { pl } from './pet-copy.pl.ts';
import { tr } from './pet-copy.tr.ts';
import { vi } from './pet-copy.vi.ts';

/** 元素面板动态贴纸里的 Codex Pets（`@baocut/protocol` 的 `pets.ts`）：分类名与讲这一类的几句。译文在 `pet-copy.zh-Hans.ts`。 */
const en = {
  title: 'Codex Pets',
  note: '8-column sprite sheets · idle loop · follows the playhead',
  peekNote: (count: number) => `${count} community pets`,
  categoryChips: 'Pet categories',
  chip: (label: string, count: number) => `${label} ${count}`,
  categories: {
    'game-characters': 'Game characters',
    'anime-characters': 'Anime characters',
    animals: 'Animals',
    'original-characters': 'Original characters',
    mascots: 'Mascots',
    others: 'Others',
    memes: 'Memes',
    'fantasy-creatures': 'Fantasy creatures',
    'human-avatars': 'Human avatars',
    robots: 'Robots',
    'objects-props': 'Objects & props',
  } as Record<string, string>,
  noMatch: 'No matching pets',
  noMatchHint: 'Try another word or category',
  nonCommercial: 'Non-commercial use only',
  communityNote:
    'Community pets come from awesome-codex-pet and are used under each author’s own license (mostly CC BY-NC 4.0; orange means non-commercial use only). The credit is saved with the asset. Thumbnails and sprite sheets are downloaded when needed and kept on this computer.',
  hint: 'A Codex Pet is the Codex desktop pet format: a WebP sprite sheet of 192×208 cells in 8 columns (9 rows in v1, 11 in v2), one state per row. On the canvas it plays the idle row as a loop that follows the playhead. The sprite sheet is downloaded the first time you use a pet and kept on this computer.',
  addFailed: (message: string) => `Couldn’t add the pet: ${message}`,
};

export type PetMessages = typeof en;
export const PET_COPY = defineMessages(en, {
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
