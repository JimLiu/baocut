import { pluralForm } from '@baocut/protocol';
import type { AddChapterRefusal } from '../../model/chapters.ts';
import type { ChapterMessages } from './chapter-copy.ts';

export const fr: ChapterMessages = {
  band: "Chapitres",
  prev: "Chapitre précédent",
  next: "Chapitre suivant",
  noChapters: "Aucun chapitre",

  gap: "Aucun chapitre",
  beforeFirst: "Avant le premier chapitre",
  add: "Ajouter un chapitre à la tête de lecture",
  rename: "Renommer…",
  remove: "Supprimer ce chapitre",
  menuLabel: (title: string) => `Chapitre « ${title} »`,
  gapMenuLabel: "Barre de chapitres",

  segmentLabel: (title: string, range: string) => `${title}, ${range}, cliquez pour aller au début`,
  dragHint: "Glissez pour déplacer le début de ce chapitre",

  addTitle: "Ajouter un chapitre",
  renameTitle: "Renommer le chapitre",
  titleLabel: "Titre",
  addAt: (time: string) => `Commence à ${time} et va jusqu’au prochain chapitre`,
  confirmAdd: "Ajouter",
  confirmRename: "Renommer",
  cancel: "Annuler",
  refusal: {
    exists: "Un chapitre existe déjà à la tête de lecture",
    beyond: "La tête de lecture est à la fin ; aucun chapitre ne peut être ajouté ici",
    blank: "Le titre ne peut pas être vide",
  } satisfies Record<AddChapterRefusal, string>,

  labels: { add: "Ajouter un chapitre", rename: "Renommer le chapitre", remove: "Supprimer le chapitre", move: "Déplacer le début du chapitre" },
  added: (title: string) => `Chapitre ajouté « ${title} »`,
  renamed: (title: string) => `Renommé en « ${title} »`,
  removed: (title: string) => `Chapitre supprimé « ${title} »`,
  undo: "Annuler",

  clickRename: "Cliquer pour renommer",
  jump: "Aller au début de ce chapitre",
  paragraphs: (n: number) => `${n} paragraphe${pluralForm('fr', n, { one: "", other: "s" })}`,
  empty: "Ce chapitre n’a pas encore de paragraphes",
};
