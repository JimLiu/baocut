import { pluralForm } from '../../i18n.ts';
import type { JobsParamsMessages } from './params.ts';

export const de: JobsParamsMessages = {
  unknownParam: (p: { key: string }) => `Unbekannter Parameter ${p.key}`,
  invalidParam: (p: { key: string; problem: string }) => `Parameter ${p.key} ${p.problem}`,
  mustBeNonEmptyString: "muss eine nichtleere Zeichenfolge sein",
  atMostChars: (p: { max: number }) => `darf höchstens enthalten: ${p.max} Zeichen`,
  mustBeIntegerBetween: (p: { min: number; max: number }) => `muss eine ganze Zahl sein von ${p.min} zu ${p.max}`,
  mustBeOneOf: (p: { values: string }) => `muss einer dieser Werte sein: ${p.values}`,
  mustBeArray: "muss ein Array sein",
  atLeastItems: (p: { min: number }) => `muss mindestens enthalten: ${p.min} ${pluralForm('de', p.min, { one: "Eintrag", other: "Einträge" })}`,
  atMostItems: (p: { max: number }) => `darf höchstens enthalten: ${p.max} ${pluralForm('de', p.max, { one: "Eintrag", other: "Einträge" })}`,
  mustBeBoolean: "muss true oder false sein",
  mustBeLanguageTag: "muss ein BCP 47-Sprachtag sein",
  mustBeAbsolutePath: "muss ein absoluter Pfad sein",
  itemsMustBeAbsolutePaths: "darf nur absolute Pfade enthalten",
  onlyOneOf: (p: { other: string }) => `kann nicht kombiniert werden mit ${p.other}`,
  createExcludesVideoId: "erstellt ein neues Video und kann nicht mit videoId kombiniert werden",
  targetShape: "muss { videoId }, { entryId } oder { create } sein",
};
