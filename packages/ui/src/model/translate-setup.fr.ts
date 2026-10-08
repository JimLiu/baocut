import type { TranslateSetupMessages } from './translate-setup.ts';

export const fr: TranslateSetupMessages = {
  sameAsSource: 'Même langue que l’original', alreadyTranslated: 'Une traduction dans cette langue existe déjà', glossaryGone: 'Absent de la bibliothèque de glossaires · non utilisé cette fois',
  reading: 'Lecture…', unreadable: 'Impossible de lire · non utilisé cette fois', anyLanguage: 'Toutes les langues', wrongDirection: (source, target) => `Direction ${source} → ${target} · non utilisé cette fois`,
};
