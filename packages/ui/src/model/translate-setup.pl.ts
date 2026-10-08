import type { TranslateSetupMessages } from './translate-setup.ts';

export const pl: TranslateSetupMessages = {
  sameAsSource: "Ten sam język co oryginał",
  alreadyTranslated: "Tłumaczenie na ten język już istnieje",
  glossaryGone: "Nie ma już w bibliotece słowników · tym razem nie zostanie użyty",
  reading: "Odczytywanie…",
  unreadable: "Nie udało się odczytać · tym razem nie zostanie użyty",
  anyLanguage: "Dowolny język",
  wrongDirection: (source: string, target: string) => `Kierunek: ${source} → ${target} · tym razem nie zostanie użyty`,
};
