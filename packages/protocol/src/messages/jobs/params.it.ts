import type { JobsParamsMessages } from './params.ts';
import { pluralForm } from '../../i18n.ts';

export const it: JobsParamsMessages = {
  unknownParam: (p) => `Parametro sconosciuto ${p.key}`,
  invalidParam: (p) => `Parametro ${p.key} ${p.problem}`,
  mustBeNonEmptyString: 'deve essere una stringa non vuota',
  atMostChars: (p) => pluralForm('it', p.max, { one: `deve contenere al massimo ${p.max} carattere`, other: `deve contenere al massimo ${p.max} caratteri` }),
  mustBeIntegerBetween: (p) => `deve essere un intero da ${p.min} a ${p.max}`,
  mustBeOneOf: (p) => `deve essere uno tra ${p.values}`,
  mustBeArray: 'deve essere un array',
  atLeastItems: (p) => pluralForm('it', p.min, { one: `deve avere almeno ${p.min} elemento`, other: `deve avere almeno ${p.min} elementi` }),
  atMostItems: (p) => pluralForm('it', p.max, { one: `deve avere al massimo ${p.max} elemento`, other: `deve avere al massimo ${p.max} elementi` }),
  mustBeBoolean: 'deve essere true o false',
  mustBeLanguageTag: 'deve essere un tag di lingua BCP 47',
  mustBeAbsolutePath: 'deve essere un percorso assoluto',
  itemsMustBeAbsolutePaths: 'deve contenere solo percorsi assoluti',
  onlyOneOf: (p) => `non può essere combinato con ${p.other}`,
  createExcludesVideoId: 'crea un nuovo video e non può essere combinato con videoId',
  targetShape: 'deve essere { videoId }, { entryId } o { create }',
};
