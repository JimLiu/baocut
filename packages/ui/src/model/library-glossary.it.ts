import type { LibraryGlossaryMessages } from './library-glossary.ts';
import { pluralForm } from '@baocut/protocol';

const chars = (n: number) => pluralForm('it', n, { one: `${n} carattere`, other: `${n} caratteri` });
const terms = (n: number) => pluralForm('it', n, { one: `${n} termine`, other: `${n} termini` });

export const it: LibraryGlossaryMessages = {
  kinds: { transcription: { label: 'Glossario di trascrizione', a: 'Grafia corretta', b: 'Spesso riconosciuto come' }, translation: { label: 'Glossario di traduzione', a: 'Origine', b: 'Traduzione' } },
  anyLanguage: 'Qualsiasi lingua', spoken: (language: string) => `Parlato in ${language}`, newTranscription: 'Nuovo glossario di trascrizione', fieldCanonical: 'Grafia corretta', fieldSource: 'Origine', fieldTarget: 'Traduzione',
  fieldEmpty: (label: string) => `È necessario compilare ${label}`,
  fieldTooLong: (label: string, max: number) => `${label} non può superare ${chars(max)}`,
  fieldNewline: (label: string) => `${label} non può contenere interruzioni di riga`,
  duplicate: (term: string) => `«${term}» è già nel glossario`,
  misheardSame: 'Una grafia riconosciuta erroneamente non può coincidere con la grafia corretta',
  misheardTooMany: (max: number) => pluralForm('it', max, { one: `Fino a ${max} grafia riconosciuta erroneamente`, other: `Fino a ${max} grafie riconosciute erroneamente` }),
  misheardTooLong: (max: number) => `Ogni grafia non può superare ${chars(max)}`,
  noteTooLong: (max: number) => `La nota non può superare ${chars(max)}`,
  nameEmpty: 'Il nome del glossario non può essere vuoto', nameTooLong: (max: number) => `Il nome del glossario non può superare ${chars(max)}`,
  skipPunctuation: 'Solo punteggiatura', skipTooLong: (max: number) => `Più di ${chars(max)}`, skipMerged: 'Stesso termine di una riga precedente; unito', skipNoTarget: 'Nessuna traduzione', skipKeptFirst: 'Stesso termine di una riga precedente; mantenuto il primo',
  allExist: 'Questi termini sono già nel glossario',
  added: (n: number) => pluralForm('it', n, { one: `${n} termine aggiunto`, other: `${n} termini aggiunti` }),
  merged: (n: number) => `${terms(n)} già nel glossario`,
  overflow: (n: number, limit: number) => `${pluralForm('it', n, { one: `${n} termine non aggiunto`, other: `${n} termini non aggiunti` })}: un glossario può contenere fino a ${terms(limit)}`,
  fileName: 'Glossario', misheardSeparator: ', ',
};
