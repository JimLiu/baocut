import type { AddChapterRefusal } from '../../model/chapters.ts';
import { pluralForm } from '@baocut/protocol';
import type { ChapterMessages } from './chapter-copy.ts';

export const nl: ChapterMessages = {
  band: "Hoofdstukken",
  prev: "Vorig hoofdstuk",
  next: "Volgend hoofdstuk",
  noChapters: "Nog geen hoofdstukken",

  gap: "Geen hoofdstuk",
  beforeFirst: "Vóór het eerste hoofdstuk",
  add: "Hoofdstuk toevoegen bij afspeelkop",
  rename: "Naam wijzigen…",
  remove: "Dit hoofdstuk verwijderen",
  menuLabel: (title: string) => `Hoofdstuk ‘${title}’`,
  gapMenuLabel: "Hoofdstukbalk",

  segmentLabel: (title: string, range: string) => `${title}, ${range}, klik om naar het begin te gaan`,
  dragHint: "Sleep om het begin van dit hoofdstuk te verplaatsen",

  addTitle: "Hoofdstuk toevoegen",
  renameTitle: "Hoofdstuk hernoemen",
  titleLabel: "Titel",
  addAt: (time: string) => `Begint op ${time} en loopt tot het volgende hoofdstuk`,
  confirmAdd: "Toevoegen",
  confirmRename: "Hernoemen",
  cancel: "Annuleren",
  refusal: {
    exists: "Er is al een hoofdstuk bij de afspeelkop",
    beyond: "De afspeelkop staat aan het einde; hier kan geen hoofdstuk worden toegevoegd",
    blank: "De titel mag niet leeg zijn",
  } satisfies Record<AddChapterRefusal, string>,

  labels: { add: "Hoofdstuk toevoegen", rename: "Hoofdstuk hernoemen", remove: "Hoofdstuk verwijderen", move: "Begin van hoofdstuk verplaatsen" },
  added: (title: string) => `Hoofdstuk toegevoegd: ‘${title}’`,
  renamed: (title: string) => `Hernoemd naar ‘${title}’`,
  removed: (title: string) => `Hoofdstuk verwijderd: ‘${title}’`,
  undo: "Ongedaan maken",

  clickRename: "Klik om te hernoemen",
  jump: "Naar het begin van dit hoofdstuk gaan",
  paragraphs: (n: number) => `${n} ${pluralForm('nl', n, { one: "alinea", other: "alinea’s" })}`,
  empty: "Dit hoofdstuk heeft nog geen alinea’s",
};
