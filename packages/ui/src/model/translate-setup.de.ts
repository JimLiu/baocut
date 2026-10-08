import type { TranslateSetupMessages } from './translate-setup.ts';

export const de: TranslateSetupMessages = {
  sameAsSource: "Gleiche Sprache wie das Original",
  alreadyTranslated: "Hat bereits eine Übersetzung in dieser Sprache",
  glossaryGone: "Nicht mehr in der Glossarbibliothek · diesmal nicht verwendet",
  reading: "Wird gelesen…",
  unreadable: "Lesen fehlgeschlagen · diesmal nicht verwendet",
  anyLanguage: "Beliebige Sprache",

  wrongDirection: (source: string, target: string) => `Richtung: ${source} → ${target} · diesmal nicht verwendet`,
};
