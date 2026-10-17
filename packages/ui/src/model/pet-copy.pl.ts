import type { PetMessages } from './pet-copy.ts';

export const pl: PetMessages = {
  title: 'Codex Pets',
  note: 'Arkusze sprite’ów w 8 kolumnach · pętla spoczynku · podąża za głowicą',
  peekNote: (count) => `Od społeczności: ${count}`,
  categoryChips: 'Kategorie zwierzaków',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': 'Postacie z gier',
    'anime-characters': 'Postacie z anime',
    animals: 'Zwierzęta',
    'original-characters': 'Postacie autorskie',
    mascots: 'Maskotki',
    others: 'Inne',
    memes: 'Memy',
    'fantasy-creatures': 'Stworzenia fantastyczne',
    'human-avatars': 'Awatary ludzi',
    robots: 'Roboty',
    'objects-props': 'Przedmioty',
  },
  noMatch: 'Brak pasujących zwierzaków',
  noMatchHint: 'Spróbuj innego słowa lub innej kategorii',
  nonCommercial: 'Tylko do użytku niekomercyjnego',
  communityNote:
    'Zwierzaki społeczności pochodzą z awesome-codex-pet i są używane na licencji podanej przez każdego autora (najczęściej CC BY-NC 4.0; pomarańczowe są tylko do użytku niekomercyjnego). Informacja o autorze jest zapisywana razem z zasobem. Miniatury i arkusze sprite’ów są pobierane w razie potrzeby i przechowywane na tym komputerze.',
  hint: 'Codex Pet to format zwierzaka na pulpit z Codex: arkusz sprite’ów WebP z komórkami 192×208 w 8 kolumnach (9 wierszy w v1, 11 w v2), jeden stan na wiersz. Na płótnie odtwarza w pętli wiersz spoczynku, podążając za głowicą. Arkusz jest pobierany przy pierwszym użyciu i przechowywany na tym komputerze.',
  addFailed: (message) => `Nie udało się dodać zwierzaka: ${message}`,
};
