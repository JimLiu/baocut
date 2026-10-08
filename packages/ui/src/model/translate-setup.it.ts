import type { TranslateSetupMessages } from './translate-setup.ts';

export const it: TranslateSetupMessages = {
  sameAsSource: "Stessa lingua dell’originale",
  alreadyTranslated: "Ha già una traduzione in questa lingua",
  glossaryGone: "Non è più nella libreria dei glossari · non usato questa volta",
  reading: "Lettura in corso…",
  unreadable: "Impossibile leggere · non usato questa volta",
  anyLanguage: "Qualsiasi lingua",
  wrongDirection: (source: string, target: string) => `La direzione è ${source} → ${target} · non usato questa volta`,
};
