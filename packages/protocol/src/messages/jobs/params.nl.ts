import { pluralForm } from '../../i18n.ts';
import type { JobsParamsMessages } from './params.ts';

export const nl: JobsParamsMessages = {
  unknownParam: (p: { key: string }) => `Onbekende parameter ${p.key}`,
  invalidParam: (p: { key: string; problem: string }) => `Parameter ${p.key} ${p.problem}`,
  mustBeNonEmptyString: "moet een niet-lege tekenreeks zijn",
  atMostChars: (p: { max: number }) => `mag maximaal bevatten: ${p.max} tekens`,
  mustBeIntegerBetween: (p: { min: number; max: number }) => `moet een geheel getal zijn van ${p.min} aan ${p.max}`,
  mustBeOneOf: (p: { values: string }) => `moet een van deze waarden zijn: ${p.values}`,
  mustBeArray: "moet een array zijn",
  atLeastItems: (p: { min: number }) => `moet minstens bevatten: ${p.min} ${pluralForm('nl', p.min, { one: "item", other: "items" })}`,
  atMostItems: (p: { max: number }) => `mag maximaal bevatten: ${p.max} ${pluralForm('nl', p.max, { one: "item", other: "items" })}`,
  mustBeBoolean: "moet true of false zijn",
  mustBeLanguageTag: "moet een BCP 47-taaltag zijn",
  mustBeAbsolutePath: "moet een absoluut pad zijn",
  itemsMustBeAbsolutePaths: "mag alleen absolute paden bevatten",
  onlyOneOf: (p: { other: string }) => `kan niet worden gecombineerd met ${p.other}`,
  createExcludesVideoId: "maakt een nieuwe video en kan niet worden gecombineerd met videoId",
  targetShape: "moet { videoId }, { entryId } of { create } zijn",
};
