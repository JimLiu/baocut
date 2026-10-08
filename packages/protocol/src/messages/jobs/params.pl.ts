import { pluralForm } from '../../i18n.ts';
import type { JobsParamsMessages } from './params.ts';

export const pl: JobsParamsMessages = {
  unknownParam: (p: { key: string }) => `Nieznany parametr ${p.key}`,
  invalidParam: (p: { key: string; problem: string }) => `Parametr ${p.key} ${p.problem}`,
  mustBeNonEmptyString: "musi być niepustym ciągiem",
  atMostChars: (p: { max: number }) => pluralForm('pl', p.max, { one: `musi mieć najwyżej ${p.max} znak`, few: `musi mieć najwyżej ${p.max} znaki`, many: `musi mieć najwyżej ${p.max} znaków`, other: `musi mieć najwyżej ${p.max} znaku` }),
  mustBeIntegerBetween: (p: { min: number; max: number }) => `musi być liczbą całkowitą od ${p.min} do ${p.max}`,
  mustBeOneOf: (p: { values: string }) => `musi być jedną z wartości ${p.values}`,
  mustBeArray: "musi być tablicą",
  atLeastItems: (p: { min: number }) => pluralForm('pl', p.min, { one: `musi mieć co najmniej ${p.min} element`, few: `musi mieć co najmniej ${p.min} elementy`, many: `musi mieć co najmniej ${p.min} elementów`, other: `musi mieć co najmniej ${p.min} elementu` }),
  atMostItems: (p: { max: number }) => pluralForm('pl', p.max, { one: `musi mieć najwyżej ${p.max} element`, few: `musi mieć najwyżej ${p.max} elementy`, many: `musi mieć najwyżej ${p.max} elementów`, other: `musi mieć najwyżej ${p.max} elementu` }),
  mustBeBoolean: "musi być true lub false",
  mustBeLanguageTag: "musi być znacznikiem języka BCP 47",
  mustBeAbsolutePath: "musi być ścieżką bezwzględną",
  itemsMustBeAbsolutePaths: "musi zawierać tylko ścieżki bezwzględne",
  onlyOneOf: (p: { other: string }) => `nie można łączyć z ${p.other}`,
  createExcludesVideoId: "tworzy nowe wideo i nie może być łączony z videoId",
  targetShape: "musi być { videoId }, { entryId } lub { create }",
};
