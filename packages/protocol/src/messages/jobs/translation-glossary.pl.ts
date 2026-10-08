import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const pl: JobsTranslationGlossaryMessages = {
  serviceClient: "Klienci usług nie mogą używać słowników z biblioteki użytkownika",
  noLibrary: "Ten Runtime nie ma biblioteki użytkownika, więc nie można używać słowników z biblioteki",
  duplicate: (p: { id: string }) => `Słownik ${p.id} występuje dwukrotnie w glossaries`,
  transcriptionGlossary: (p: { name: string }) => `„${p.name}” to słownik transkrypcji i nie można go użyć do tłumaczenia`,
  languageMismatch: (p: { name: string; source: string; target: string }) => `„${p.name}” to słownik ${p.source} → ${p.target}, który nie odpowiada językom tego tłumaczenia`,
  languageMismatchAnySource: (p: { name: string; target: string }) => `„${p.name}” to słownik z dowolnego języka na ${p.target}, który nie odpowiada językom tego tłumaczenia`,
  refMalformed: "glossaryRef ma nieprawidłową strukturę",
  refIncompleteEntry: "glossaryRef.entries zawiera niepełny wpis",
  refIncompleteTerm: "glossaryRef.terms zawiera niepełny termin",
};
