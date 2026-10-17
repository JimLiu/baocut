import type { PetMessages } from './pet-copy.ts';

export const nl: PetMessages = {
  title: 'Codex Pets',
  note: 'Spritesheets met 8 kolommen · rustlus · volgt de afspeelkop',
  peekNote: (count) => `${count} uit de community`,
  categoryChips: 'Huisdiercategorieën',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': 'Gamepersonages',
    'anime-characters': 'Animepersonages',
    animals: 'Dieren',
    'original-characters': 'Eigen personages',
    mascots: 'Mascottes',
    others: 'Overig',
    memes: 'Memes',
    'fantasy-creatures': 'Fantasiewezens',
    'human-avatars': 'Menselijke avatars',
    robots: 'Robots',
    'objects-props': 'Voorwerpen',
  },
  noMatch: 'Geen passende huisdieren',
  noMatchHint: 'Probeer een ander woord of een andere categorie',
  nonCommercial: 'Alleen niet-commercieel gebruik',
  communityNote:
    'Communityhuisdieren komen uit awesome-codex-pet en worden gebruikt onder de licentie die elke maker opgeeft (meestal CC BY-NC 4.0; oranje betekent alleen niet-commercieel gebruik). De naamsvermelding wordt bij het item bewaard. Miniaturen en spritesheets worden gedownload wanneer nodig en op deze computer bewaard.',
  hint: 'Een Codex Pet is het bureaubladhuisdierformaat van Codex: een WebP-spritesheet met cellen van 192×208 in 8 kolommen (9 rijen in v1, 11 in v2), één toestand per rij. Op het canvas speelt de rustrij in een lus die de afspeelkop volgt. Het spritesheet wordt de eerste keer gedownload en op deze computer bewaard.',
  addFailed: (message) => `Kan het huisdier niet toevoegen: ${message}`,
};
