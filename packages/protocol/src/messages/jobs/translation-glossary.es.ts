import type { JobsTranslationGlossaryMessages } from './translation-glossary.ts';
export const es: JobsTranslationGlossaryMessages = {
 serviceClient: 'Los clientes de servicios no pueden usar glosarios de la biblioteca del usuario', noLibrary: 'Este Runtime no tiene una biblioteca del usuario, por lo que no se pueden usar sus glosarios',
 duplicate: (p) => `El glosario ${p.id} aparece dos veces en glossaries`, transcriptionGlossary: (p) => `«${p.name}» es un glosario de transcripción y no se puede usar para traducir`,
 languageMismatch: (p) => `«${p.name}» es un glosario ${p.source} → ${p.target}, que no coincide con los idiomas de esta traducción`, languageMismatchAnySource: (p) => `«${p.name}» es un glosario de cualquier idioma → ${p.target}, que no coincide con los idiomas de esta traducción`,
 refMalformed: 'glossaryRef tiene una estructura incorrecta', refIncompleteEntry: 'glossaryRef.entries contiene una entrada incompleta', refIncompleteTerm: 'glossaryRef.terms contiene un término incompleto',
};
