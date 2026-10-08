const chars = (n: number) => `${n} ${pluralForm('de', n, { one: 'Zeichen', other: 'Zeichen' })}`;
const terms = (n: number) => pluralForm('de', n, { one: `${n} Begriff`, other: `${n} Begriffe` });
import { pluralForm } from '@baocut/protocol';
import type { LibraryGlossaryMessages } from './library-glossary.ts';

export const de: LibraryGlossaryMessages = {
  kinds: {
    transcription: { label: "Transkriptionsglossar", a: "Richtige Schreibweise", b: "Häufig falsch erkannt als" },
    translation: { label: "Übersetzungsglossar", a: "Quelle", b: "Übersetzung" },
  } as Record<'transcription' | 'translation', { label: string; a: string; b: string }>,
  anyLanguage: "Beliebige Sprache",
  spoken: (language: string) => `${language} Sprache`,
  newTranscription: "Neues Transkriptionsglossar",
  fieldCanonical: "Richtige Schreibweise",
  fieldSource: "Quelle",
  fieldTarget: "Übersetzung",
  fieldEmpty: (label: string) => `${label} darf nicht leer sein`,
  fieldTooLong: (label: string, max: number) => `${label} darf nicht länger sein als ${chars(max)}`,
  fieldNewline: (label: string) => `${label} darf keine Zeilenumbrüche enthalten`,
  duplicate: (term: string) => `„${term}“ ist bereits im Glossar`,
  misheardSame: "Fehlerhafte Schreibweise darf nicht der richtigen entsprechen",
  misheardTooMany: (max: number) => `Bis zu ${max} fehlerhafte Schreibweisen`,
  misheardTooLong: (max: number) => `Jede Schreibweise darf nicht länger sein als ${chars(max)}`,
  noteTooLong: (max: number) => `Die Notiz darf nicht länger sein als ${chars(max)}`,
  nameEmpty: "Der Glossarname darf nicht leer sein",
  nameTooLong: (max: number) => `Der Glossarname darf nicht länger sein als ${chars(max)}`,
  skipPunctuation: "Nur Zeichensetzung",
  skipTooLong: (max: number) => `Länger als ${chars(max)}`,
  skipMerged: "Begriff einer früheren Zeile; zusammengeführt",
  skipNoTarget: "Keine Übersetzung",
  skipKeptFirst: "Begriff einer früheren Zeile; erster Eintrag behalten",
  allExist: "Diese Begriffe sind bereits im Glossar",
  added: (n: number) => `Hinzugefügt: ${terms(n)}`,
  merged: (n: number) => `${terms(n)} bereits im Glossar`,
  overflow: (n: number, limit: number) => `${terms(n)} nicht hinzugefügt; ein Glossar fasst höchstens ${limit} Begriffe`,
  fileName: "Glossar",

  misheardSeparator: ", ",
};
