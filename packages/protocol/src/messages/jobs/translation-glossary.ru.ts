import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const ru: JobsTranslationGlossaryMessages = {
  serviceClient: "Клиенты сервисов не могут использовать глоссарии пользовательской библиотеки",
  noLibrary: "У этого Runtime нет пользовательской библиотеки, поэтому глоссарии из неё недоступны",
  duplicate: (p: { id: string }) => `Глоссарий ${p.id} указан дважды в glossaries`,
  transcriptionGlossary: (p: { name: string }) => `«${p.name}» — глоссарий расшифровки, его нельзя использовать для перевода`,
  languageMismatch: (p: { name: string; source: string; target: string }) => `«${p.name}» — глоссарий ${p.source} → ${p.target}, его языки не совпадают с языками этого перевода`,
  languageMismatchAnySource: (p: { name: string; target: string }) => `«${p.name}» — глоссарий с любого языка на ${p.target}, его языки не совпадают с языками этого перевода`,
  refMalformed: "glossaryRef имеет неверную структуру",
  refIncompleteEntry: "glossaryRef.entries содержит неполную запись",
  refIncompleteTerm: "glossaryRef.terms содержит неполный термин",
};
