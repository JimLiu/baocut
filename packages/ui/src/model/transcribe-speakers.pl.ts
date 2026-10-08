import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const pl: TranscribeSpeakersMessages = {
  packFallback: "Rozróżnianie mówców",
  builtinNote: (model: string) => `${model} sam rozróżnia mówców podczas transkrypcji`,
  builtinSummary: "Rozpoznawanie mówców · wbudowane w model",
  noneNote: (model: string) => `${model} nie rozróżnia mówców. Jeśli tego potrzebujesz, wybierz model lokalny lub usługę z wbudowaną obsługą`,
  missingNote: (pack: string, size: string | null) => `Najpierw pobierz „${pack}”${size ? ` (${size})` : ""}, aby rozróżniać mówców`,
  missingSummary: "Rozpoznawanie mówców · najpierw pobierz model",
  onNote: "Po transkrypcji funkcja „Rozróżnianie mówców” przypisuje mówcę każdemu zdaniu, a napisy i transkrypcje zawierają imiona",
  summaryOn: "Zidentyfikuj mówców",
  offNote: "Mówcy nie są rozróżniani; napisy i transkrypcje nie będą zawierać imion",
  summaryOff: "Nie rozpoznawaj mówców",
  downloading: (pack: string, pct: number | null) => `Pobieranie „${pack}”${pct === null ? "…" : ` · ${pct}%`}`,
};
