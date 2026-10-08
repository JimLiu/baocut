import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const nl: TranscribeSpeakersMessages = {
  packFallback: "Sprekers scheiden",
  builtinNote: (model: string) => `${model} onderscheidt zelf sprekers tijdens de transcriptie`,
  builtinSummary: "Sprekers identificeren · ingebouwd in het model",
  noneNote: (model: string) => `${model} onderscheidt geen sprekers. Kies indien nodig een lokaal model of dienst waarin dit is ingebouwd`,
  missingNote: (pack: string, size: string | null) => `Download ‘${pack}’${size ? ` (${size})` : ""} eerst om sprekers te onderscheiden`,
  missingSummary: "Sprekers identificeren · download eerst het model",
  onNote: "Na het transcriberen labelt ‘Sprekers scheiden’ elke zin met de spreker, en ondertitels en transcripten bevatten de namen",
  summaryOn: "Sprekers identificeren",
  offNote: "Sprekers worden niet onderscheiden; ondertitels en transcripten bevatten geen namen",
  summaryOff: "Sprekers niet identificeren",

  downloading: (pack: string, pct: number | null) => `Downloaden: ‘${pack}’${pct === null ? "…" : ` · ${pct}%`}`,
};
