import type { LibraryGlossaryMessages } from './library-glossary.ts';
import { pluralForm } from '@baocut/protocol';
const charsEs = (n: number) => `${n} ${pluralForm('es', n, { one: 'carácter', other: 'caracteres' })}`;
const termsEs = (n: number) => `${n} ${pluralForm('es', n, { one: 'término', other: 'términos' })}`;
export const es: LibraryGlossaryMessages = {
 kinds: { transcription: { label: 'Glosario de transcripción', a: 'Ortografía correcta', b: 'Suele reconocerse como' }, translation: { label: 'Glosario de traducción', a: 'Original', b: 'Traducción' } },
 anyLanguage: 'Cualquier idioma', spoken: (language) => `Voz en ${language}`, newTranscription: 'Nuevo glosario de transcripción',
 fieldCanonical: 'Ortografía correcta', fieldSource: 'Original', fieldTarget: 'Traducción',
 fieldEmpty: (label) => `${label} no puede estar vacío`, fieldTooLong: (label, max) => `${label} no puede superar los ${charsEs(max)}`,
 fieldNewline: (label) => `${label} no puede contener saltos de línea`, duplicate: (term) => `«${term}» ya está en el glosario`,
 misheardSame: 'Una grafía mal reconocida no puede ser igual a la correcta', misheardTooMany: (max) => `Hasta ${max} grafías mal reconocidas`,
 misheardTooLong: (max) => `Cada grafía no puede superar los ${charsEs(max)}`, noteTooLong: (max) => `La nota no puede superar los ${charsEs(max)}`,
 nameEmpty: 'El nombre del glosario no puede estar vacío', nameTooLong: (max) => `El nombre del glosario no puede superar los ${charsEs(max)}`,
 skipPunctuation: 'Solo puntuación', skipTooLong: (max) => `Supera los ${charsEs(max)}`, skipMerged: 'Mismo término que en una línea anterior; combinado',
 skipNoTarget: 'Sin traducción', skipKeptFirst: 'Mismo término que en una línea anterior; se conserva el primero', allExist: 'Estos términos ya están en el glosario',
 added: (n) => `${pluralForm('es', n, { one: `Añadido ${termsEs(n)}`, other: `Añadidos ${termsEs(n)}` })}`,
 merged: (n) => `${termsEs(n)} ya en el glosario`, overflow: (n, limit) => `${termsEs(n)} sin añadir: un glosario admite hasta ${limit} términos`,
 fileName: 'Glosario', misheardSeparator: ', ',
};
