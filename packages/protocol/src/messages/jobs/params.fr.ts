import { pluralForm } from '../../i18n.ts';
import type { JobsParamsMessages } from './params.ts';

export const fr: JobsParamsMessages = {
  unknownParam: (p: { key: string }) => `Paramètre inconnu ${p.key}`,
  invalidParam: (p: { key: string; problem: string }) => `Le paramètre ${p.key} ${p.problem}`,
  mustBeNonEmptyString: "doit être une chaîne non vide",
  atMostChars: (p: { max: number }) => `doit être au plus ${p.max} caractères`,
  mustBeIntegerBetween: (p: { min: number; max: number }) => `doit être un entier de ${p.min} vers ${p.max}`,
  mustBeOneOf: (p: { values: string }) => `doit être une valeur parmi ${p.values}`,
  mustBeArray: "doit être un tableau",
  atLeastItems: (p: { min: number }) => `doit contenir au moins ${p.min} ${pluralForm('fr', p.min, { one: "élément", other: "éléments" })}`,
  atMostItems: (p: { max: number }) => `doit contenir au plus ${p.max} ${pluralForm('fr', p.max, { one: "élément", other: "éléments" })}`,
  mustBeBoolean: "doit être true ou false",
  mustBeLanguageTag: "doit être une étiquette de langue BCP 47",
  mustBeAbsolutePath: "doit être un chemin absolu",
  itemsMustBeAbsolutePaths: "doit contenir uniquement des chemins absolus",
  onlyOneOf: (p: { other: string }) => `ne peut pas être combiné avec ${p.other}`,
  createExcludesVideoId: "crée une vidéo et ne peut pas être combiné avec videoId",
  targetShape: "doit être { videoId }, { entryId } ou { create }",
};
