import type { TranslateSetupMessages } from './translate-setup.ts';

export const ptBR: TranslateSetupMessages = {
  sameAsSource: "Mesmo idioma do original",
  alreadyTranslated: "Já tem tradução neste idioma",
  glossaryGone: "Não está mais na biblioteca de glossários · não usado desta vez",
  reading: "Lendo…",
  unreadable: "Não foi possível ler · não usado desta vez",
  anyLanguage: "Qualquer idioma",
  wrongDirection: (source: string, target: string) => `A direção é ${source} → ${target} · não usado desta vez`,
};
