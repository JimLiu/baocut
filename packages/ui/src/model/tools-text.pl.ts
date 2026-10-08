import type { ToolsTextMessages } from './tools-text.ts';

export const pl: ToolsTextMessages = {
  emptyInput: "Najpierw wpisz, co wygenerować",
  tooLong: (max) => `Do ${max} znaków naraz`,
  sample: "Napisz 30-sekundowy tekst do dubbingu wideo ze spaceru po mieście. Zachowaj naturalny ton i opisz ulice, kawiarnie i zmierzch.",
  counter: (n, max) => `${n} / ${max} znaków`,
  connectTextModel: "Najpierw połącz model tekstowy",
  connectFirst: (provider) => `Najpierw połącz ${provider}`,
  effortFixed: "Intensywność rozumowania · ten model nie pozwala jej zmienić",
  effort: (label) => `Intensywność rozumowania · ${label} (domyślna wartość na stronie „Modele”)`,
  auto: "Automatyczny",
  headerChip: (provider) => `Online · ${provider} · opłata za tokeny`,
  fileStem: "Wygenerowany tekst",
  chars: (n) => `${n} znaków`,
  outputTokens: (n) => `${n} tokenów wyjściowych`,
  truncated: "Osiągnięto limit wyniku; reszta została ucięta",
};
