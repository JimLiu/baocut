import type { AddChapterRefusal } from '../../model/chapters.ts';
import { pluralForm } from '@baocut/protocol';
import type { ChapterMessages } from './chapter-copy.ts';

export const de: ChapterMessages = {
  band: "Kapitel",
  prev: "Vorheriges Kapitel",
  next: "Nächstes Kapitel",
  noChapters: "Noch keine Kapitel",

  gap: "Kein Kapitel",
  beforeFirst: "Vor dem ersten Kapitel",
  add: "Kapitel am Abspielkopf hinzufügen",
  rename: "Umbenennen…",
  remove: "Dieses Kapitel löschen",
  menuLabel: (title: string) => `Kapitel „${title}“`,
  gapMenuLabel: "Kapitelleiste",

  segmentLabel: (title: string, range: string) => `${title}, ${range}, klicken zum Anfang springen`,
  dragHint: "Ziehen, um den Kapitelanfang zu verschieben",

  addTitle: "Kapitel hinzufügen",
  renameTitle: "Kapitel umbenennen",
  titleLabel: "Titel",
  addAt: (time: string) => `Beginnt bei ${time} und reicht bis zum nächsten Kapitel`,
  confirmAdd: "Hinzufügen",
  confirmRename: "Umbenennen",
  cancel: "Abbrechen",
  refusal: {
    exists: "Am Abspielkopf gibt es bereits ein Kapitel",
    beyond: "Der Abspielkopf ist am Ende; hier kann kein Kapitel hinzugefügt werden",
    blank: "Der Titel darf nicht leer sein",
  } satisfies Record<AddChapterRefusal, string>,

  labels: { add: "Kapitel hinzufügen", rename: "Kapitel umbenennen", remove: "Kapitel löschen", move: "Kapitelanfang verschieben" },
  added: (title: string) => `Kapitel hinzugefügt: „${title}“`,
  renamed: (title: string) => `Umbenannt in „${title}“`,
  removed: (title: string) => `Kapitel gelöscht: „${title}“`,
  undo: "Rückgängig machen",

  clickRename: "Klicken zum Umbenennen",
  jump: "Zum Anfang dieses Kapitels springen",
  paragraphs: (n: number) => `${n} ${pluralForm('de', n, { one: "Absatz", other: "Absätze" })}`,
  empty: "Dieses Kapitel hat noch keine Absätze",
};
