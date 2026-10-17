import type { PetMessages } from './pet-copy.ts';

export const it: PetMessages = {
  title: 'Codex Pets',
  note: 'Sprite sheet a 8 colonne · loop a riposo · segue la testina',
  peekNote: (count) => `${count} della community`,
  categoryChips: 'Categorie di animaletti',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': 'Personaggi dei videogiochi',
    'anime-characters': 'Personaggi anime',
    animals: 'Animali',
    'original-characters': 'Personaggi originali',
    mascots: 'Mascotte',
    others: 'Altro',
    memes: 'Meme',
    'fantasy-creatures': 'Creature fantastiche',
    'human-avatars': 'Avatar umani',
    robots: 'Robot',
    'objects-props': 'Oggetti e accessori',
  },
  noMatch: 'Nessun animaletto corrispondente',
  noMatchHint: 'Prova un’altra parola o un’altra categoria',
  nonCommercial: 'Solo uso non commerciale',
  communityNote:
    'Gli animaletti della community vengono da awesome-codex-pet e si usano con la licenza indicata da ciascun autore (per lo più CC BY-NC 4.0; in arancione, solo uso non commerciale). Il credito viene salvato con la risorsa. Miniature e sprite sheet vengono scaricati quando servono e conservati su questo computer.',
  hint: 'Un Codex Pet è il formato degli animaletti da scrivania di Codex: uno sprite sheet WebP con celle 192×208 su 8 colonne (9 righe nella v1, 11 nella v2), uno stato per riga. Sulla tela riproduce in loop la riga di riposo seguendo la testina. Lo sprite sheet viene scaricato al primo utilizzo e conservato su questo computer.',
  addFailed: (message) => `Impossibile aggiungere l’animaletto: ${message}`,
};
