import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';

export const tr: JobsTranslationGlossaryMessages = {
serviceClient: 'Hizmet istemcileri kullanıcı kitaplığındaki sözlükleri kullanamaz', noLibrary: 'Bu Runtime kullanıcı kitaplığına sahip değil; kitaplık sözlükleri kullanılamaz', duplicate: (p) => `${p.id} sözlüğü glossaries içinde iki kez yer alıyor`, transcriptionGlossary: (p) => `“${p.name}” yazıya dökme sözlüğüdür; çeviride kullanılamaz`, languageMismatch: (p) => `“${p.name}” ${p.source} → ${p.target} sözlüğüdür; bu çevirinin dilleriyle eşleşmiyor`, languageMismatchAnySource: (p) => `“${p.name}” herhangi bir dil → ${p.target} sözlüğüdür; bu çevirinin dilleriyle eşleşmiyor`, refMalformed: 'glossaryRef biçimi yanlış', refIncompleteEntry: 'glossaryRef.entries eksik öğe içeriyor', refIncompleteTerm: 'glossaryRef.terms eksik terim içeriyor',
};
