import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const ptBR: JobsTranslationGlossaryMessages = {
  serviceClient: "Clientes de serviços externos não podem usar glossários da biblioteca do usuário",
  noLibrary: "Este Runtime não tem biblioteca do usuário, então não é possível usar glossários da biblioteca",
  duplicate: (p: { id: string }) => `O glossário ${p.id} aparece duas vezes em glossaries`,
  transcriptionGlossary: (p: { name: string }) => `“${p.name}” é um glossário de transcrição e não pode ser usado para tradução`,
  languageMismatch: (p: { name: string; source: string; target: string }) =>
    `“${p.name}” é um glossário de ${p.source} → ${p.target}, que não corresponde aos idiomas desta tradução`,
  languageMismatchAnySource: (p: { name: string; target: string }) => `“${p.name}” é um glossário de qualquer idioma → ${p.target}, que não corresponde aos idiomas desta tradução`,
  refMalformed: "glossaryRef tem formato incorreto",
  refIncompleteEntry: "glossaryRef.entries contém uma entrada incompleta",
  refIncompleteTerm: "glossaryRef.terms contém um termo incompleto",
};
