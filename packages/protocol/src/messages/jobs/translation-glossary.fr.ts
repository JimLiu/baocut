import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const fr: JobsTranslationGlossaryMessages = {
  serviceClient: "Les clients de services ne peuvent pas utiliser les glossaires de la bibliothèque utilisateur",
  noLibrary: "Ce Runtime n’a pas de bibliothèque utilisateur ; les glossaires de bibliothèque sont indisponibles",
  duplicate: (p: { id: string }) => `Le glossaire ${p.id} apparaît deux fois dans glossaries`,
  transcriptionGlossary: (p: { name: string }) => `« ${p.name} » est un glossaire de transcription et ne peut pas servir à la traduction`,
  languageMismatch: (p: { name: string; source: string; target: string }) =>
    `« ${p.name} » est un glossaire ${p.source} → ${p.target} qui ne correspond pas aux langues de cette traduction`,
  languageMismatchAnySource: (p: { name: string; target: string }) =>
    `« ${p.name} » est un glossaire toutes langues → ${p.target} qui ne correspond pas aux langues de cette traduction`,
  refMalformed: "glossaryRef a une forme incorrecte",
  refIncompleteEntry: "glossaryRef.entries contient une entrée incomplète",
  refIncompleteTerm: "glossaryRef.terms contient un terme incomplet",
};
