import type { TranslateSetupMessages } from './translate-setup.ts';

export const nl: TranslateSetupMessages = {
  sameAsSource: "Dezelfde taal als het origineel",
  alreadyTranslated: "Heeft al een vertaling in deze taal",
  glossaryGone: "Niet meer in de woordenlijstbibliotheek · deze keer niet gebruikt",
  reading: "Lezen…",
  unreadable: "Kan niet worden gelezen · deze keer niet gebruikt",
  anyLanguage: "Elke taal",

  wrongDirection: (source: string, target: string) => `Richting: ${source} → ${target} · deze keer niet gebruikt`,
};
