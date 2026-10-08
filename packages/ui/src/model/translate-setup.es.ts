import type { TranslateSetupMessages } from './translate-setup.ts';
export const es: TranslateSetupMessages = {
  sameAsSource: 'Mismo idioma que el original', alreadyTranslated: 'Ya tiene una traducción en este idioma',
  glossaryGone: 'Ya no está en la biblioteca de glosarios · no se usa esta vez',
  reading: 'Leyendo…', unreadable: 'No se pudo leer · no se usa esta vez', anyLanguage: 'Cualquier idioma',
  wrongDirection: (source: string, target: string) => `La dirección es ${source} → ${target} · no se usa esta vez`,
};
