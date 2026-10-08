import type { JobsParamsMessages } from './params.ts';
import { pluralForm } from '../../i18n.ts';
export const es: JobsParamsMessages = {
 unknownParam: (p) => `Parámetro desconocido ${p.key}`, invalidParam: (p) => `El parámetro ${p.key} ${p.problem}`, mustBeNonEmptyString: 'debe ser una cadena no vacía',
 atMostChars: (p) => `debe tener como máximo ${p.max} caracteres`, mustBeIntegerBetween: (p) => `debe ser un entero entre ${p.min} y ${p.max}`, mustBeOneOf: (p) => `debe ser uno de ${p.values}`, mustBeArray: 'debe ser un array',
 atLeastItems: (p) => `debe tener al menos ${p.min} ${pluralForm('es', p.min, { one: 'elemento', other: 'elementos' })}`,
 atMostItems: (p) => `debe tener como máximo ${p.max} ${pluralForm('es', p.max, { one: 'elemento', other: 'elementos' })}`,
 mustBeBoolean: 'debe ser true o false', mustBeLanguageTag: 'debe ser una etiqueta de idioma BCP 47', mustBeAbsolutePath: 'debe ser una ruta absoluta', itemsMustBeAbsolutePaths: 'debe contener solo rutas absolutas',
 onlyOneOf: (p) => `no se puede combinar con ${p.other}`, createExcludesVideoId: 'crea un vídeo nuevo y no se puede combinar con videoId', targetShape: 'debe ser { videoId }, { entryId } o { create }',
};
