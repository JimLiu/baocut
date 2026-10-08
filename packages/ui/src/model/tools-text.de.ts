import type { ToolsTextMessages } from './tools-text.ts';

export const de: ToolsTextMessages = {
  emptyInput: "Zuerst eingeben, was erzeugt werden soll",
  tooLong: (max: string) => `Bis zu ${max} Zeichen auf einmal`,

  sample: "Schreiben Sie eine 30-sekündige Vertonung für ein Video über einen Stadtspaziergang. Natürlicher Ton mit Straßen, Cafés und Abenddämmerung.",
  counter: (n: string, max: string) => `${n} / ${max} Zeichen`,
  connectTextModel: "Zuerst ein Textmodell verbinden",
  connectFirst: (provider: string) => `Verbinden: ${provider}`,
  effortFixed: "Denkaufwand · bei diesem Modell nicht einstellbar",
  effort: (label: string) => `Denkaufwand · ${label} (Standard auf der Seite „Modelle“ festgelegt)`,
  auto: "Automatisch",
  headerChip: (provider: string) => `Online · ${provider} · pro Token abgerechnet`,

  fileStem: "Erzeugter Text",
  chars: (n: string) => `${n} Zeichen`,
  outputTokens: (n: string) => `${n} Ausgabe-Token`,
  truncated: "Ausgabelimit erreicht; der Rest wurde abgeschnitten",
};
