import type { JobsLibraryMessages } from './job-library.ts';
export const es: JobsLibraryMessages = {
 serviceNoGlossaries: 'Los clientes de servicios externos no pueden usar glosarios de la biblioteca del usuario', serviceNoVoices: 'Los clientes de servicios externos no pueden usar voces de la biblioteca del usuario',
 noLibraryForGlossaries: 'Este Runtime no tiene una biblioteca del usuario, por lo que no se pueden usar glosarios', noLibraryForVoices: 'Este Runtime no tiene una biblioteca del usuario, por lo que no se pueden usar voces de la biblioteca',
 translationGlossary: (p) => `«${p.name}» es un glosario de traducción y no se puede usar para transcribir`,
};
