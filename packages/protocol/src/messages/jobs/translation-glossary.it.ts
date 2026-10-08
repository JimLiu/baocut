import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const it: JobsTranslationGlossaryMessages = {
  serviceClient: "I client dei servizi esterni non possono usare i glossari della libreria utente",
  noLibrary: "Questo Runtime non ha una libreria utente, quindi non è possibile usare i glossari della libreria",
  duplicate: (p: { id: string }) => `Il glossario ${p.id} compare due volte in glossaries`,
  transcriptionGlossary: (p: { name: string }) => `«${p.name}» è un glossario di trascrizione e non può essere usato per la traduzione`,
  languageMismatch: (p: { name: string; source: string; target: string }) =>
    `«${p.name}» è un glossario ${p.source} → ${p.target}, che non corrisponde alle lingue di questa traduzione`,
  languageMismatchAnySource: (p: { name: string; target: string }) => `«${p.name}» è un glossario qualsiasi lingua → ${p.target}, che non corrisponde alle lingue di questa traduzione`,
  refMalformed: "glossaryRef ha una struttura errata",
  refIncompleteEntry: "glossaryRef.entries contiene una voce incompleta",
  refIncompleteTerm: "glossaryRef.terms contiene un termine incompleto",
};
