import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const de: JobsTranslationGlossaryMessages = {
  serviceClient: "Dienst-Clients können keine Glossare aus der Benutzerbibliothek verwenden",
  noLibrary: "Diese Runtime hat keine Benutzerbibliothek; Glossare aus der Bibliothek können daher nicht verwendet werden",
  duplicate: (p: { id: string }) => `Glossar ${p.id} erscheint zweimal in glossaries`,
  transcriptionGlossary: (p: { name: string }) => `„${p.name}“ ist ein Transkriptionsglossar und kann nicht zum Übersetzen verwendet werden`,
  languageMismatch: (p: { name: string; source: string; target: string }) =>
    `„${p.name}“ ist ein Glossar für ${p.source} → ${p.target}; passt nicht zu den Sprachen dieser Übersetzung`,
  languageMismatchAnySource: (p: { name: string; target: string }) =>
    `„${p.name}“ ist für beliebige Sprachen → ${p.target}; passt nicht zu den Sprachen dieser Übersetzung`,
  refMalformed: "glossaryRef hat die falsche Struktur",
  refIncompleteEntry: "glossaryRef.entries enthält einen unvollständigen Eintrag",
  refIncompleteTerm: "glossaryRef.terms enthält einen unvollständigen Begriff",
};
