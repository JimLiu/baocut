import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const nl: JobsTranslationGlossaryMessages = {
  serviceClient: "Dienstclients kunnen geen woordenlijsten uit de gebruikersbibliotheek gebruiken",
  noLibrary: "Deze Runtime heeft geen gebruikersbibliotheek, dus bibliotheekwoordenlijsten kunnen niet worden gebruikt",
  duplicate: (p: { id: string }) => `Woordenlijst ${p.id} staat twee keer in glossaries`,
  transcriptionGlossary: (p: { name: string }) => `‘${p.name}’ is een transcriptwoordenlijst en kan niet worden gebruikt voor vertaling`,
  languageMismatch: (p: { name: string; source: string; target: string }) =>
    `‘${p.name}’ is een woordenlijst voor ${p.source} → ${p.target}; past niet bij de talen van deze vertaling`,
  languageMismatchAnySource: (p: { name: string; target: string }) =>
    `‘${p.name}’ is voor elke taal → ${p.target}; past niet bij de talen van deze vertaling`,
  refMalformed: "glossaryRef heeft de verkeerde structuur",
  refIncompleteEntry: "glossaryRef.entries bevat een onvolledig item",
  refIncompleteTerm: "glossaryRef.terms bevat een onvolledige term",
};
