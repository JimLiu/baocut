import type { LibraryGlossaryMessages } from './library-glossary.ts';

import { pluralForm } from '@baocut/protocol';
const chars = (n: number) => `${n} ${pluralForm('fr', n, { one: 'caractère', other: 'caractères' })}`;
const terms = (n: number) => `${n} ${pluralForm('fr', n, { one: 'terme', other: 'termes' })}`;

export const fr: LibraryGlossaryMessages = {
  kinds: {
    transcription: { label: "Glossaire de transcription", a: "Orthographe correcte", b: "Souvent mal reconnu comme" },
    translation: { label: "Glossaire de traduction", a: "Source", b: "Traduction" },
  } as Record<'transcription' | 'translation', { label: string; a: string; b: string }>,
  anyLanguage: "Toute langue",
  spoken: (language: string) => `${language} parole`,
  newTranscription: "Nouveau glossaire de transcription",
  fieldCanonical: "Orthographe correcte",
  fieldSource: "Source",
  fieldTarget: "Traduction",
  fieldEmpty: (label: string) => `${label} ne peut pas être vide`,
  fieldTooLong: (label: string, max: number) => `${label} ne peut pas dépasser ${chars(max)}`,
  fieldNewline: (label: string) => `${label} ne peut pas contenir de sauts de ligne`,
  duplicate: (term: string) => `« ${term} » est déjà dans le glossaire`,
  misheardSame: "Une erreur de reconnaissance ne peut pas être identique à l’orthographe correcte",
  misheardTooMany: (max: number) => `Jusqu’à ${max} orthographes mal reconnues`,
  misheardTooLong: (max: number) => `Chaque orthographe ne peut pas dépasser ${chars(max)}`,
  noteTooLong: (max: number) => `La note ne peut pas dépasser ${chars(max)}`,
  nameEmpty: "Le nom du glossaire ne peut pas être vide",
  nameTooLong: (max: number) => `Le nom du glossaire ne peut pas dépasser ${chars(max)}`,
  skipPunctuation: "Ponctuation seule",
  skipTooLong: (max: number) => `Plus long que ${chars(max)}`,
  skipMerged: "Terme déjà présent plus haut ; fusionné",
  skipNoTarget: "Aucune traduction",
  skipKeptFirst: "Terme déjà présent plus haut ; premier conservé",
  allExist: "Ces termes sont déjà dans le glossaire",
  added: (n: number) => `Ajouté : ${terms(n)}`,
  merged: (n: number) => `${terms(n)} déjà dans le glossaire`,
  overflow: (n: number, limit: number) => `${terms(n)} non ajoutés : glossaire limité à ${limit} termes`,
  fileName: "Glossaire",

  misheardSeparator: ", ",
};
