import { pluralForm } from '@baocut/protocol';
import type { ChapterMessages } from './chapter-copy.ts';

export const pl: ChapterMessages = {
  band: "Rozdziały",
  prev: "Poprzedni rozdział",
  next: "Następny rozdział",
  noChapters: "Nie ma jeszcze rozdziałów",

  gap: "Brak rozdziału",
  beforeFirst: "Przed pierwszym rozdziałem",
  add: "Dodaj rozdział przy głowicy odtwarzania",
  rename: "Zmień nazwę…",
  remove: "Usuń ten rozdział",
  menuLabel: (title: string) => `Rozdział „${title}”`,
  gapMenuLabel: "Pasek rozdziałów",

  segmentLabel: (title: string, range: string) => `${title}, ${range}, kliknij, aby przejść do początku`,
  dragHint: "Przeciągnij, aby przesunąć początek rozdziału",

  addTitle: "Dodaj rozdział",
  renameTitle: "Zmień nazwę rozdziału",
  titleLabel: "Tytuł",
  addAt: (time: string) => `Zaczyna się o ${time} i trwa do następnego rozdziału`,
  confirmAdd: "Dodaj",
  confirmRename: "Zmień nazwę",
  cancel: "Anuluj",
  refusal: {
    exists: "Przy głowicy odtwarzania jest już rozdział",
    beyond: "Głowica odtwarzania jest na końcu; nie można tu dodać rozdziału",
    blank: "Tytuł nie może być pusty",
  },

  labels: { add: "Dodaj rozdział", rename: "Zmień nazwę rozdziału", remove: "Usuń rozdział", move: "Przesuń początek rozdziału" },
  added: (title: string) => `Dodano rozdział „${title}”`,
  renamed: (title: string) => `Zmieniono nazwę na „${title}”`,
  removed: (title: string) => `Usunięto rozdział „${title}”`,
  undo: "Cofnij",

  clickRename: "Kliknij, aby zmienić nazwę",
  jump: "Przejdź do początku rozdziału",
  paragraphs: (n: number) => pluralForm('pl', n, { one: `${n} akapit`, few: `${n} akapity`, many: `${n} akapitów`, other: `${n} akapitu` }),
  empty: "Ten rozdział nie ma jeszcze akapitów",
};
