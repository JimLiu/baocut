import type { TranscribeSpeakersMessages } from './transcribe-speakers.ts';

export const de: TranscribeSpeakersMessages = {
  packFallback: "Sprechertrennung",
  builtinNote: (model: string) => `${model} unterscheidet Sprecher selbständig während der Transkription`,
  builtinSummary: "Sprecher erkennen · im Modell integriert",
  noneNote: (model: string) => `${model} unterscheidet keine Sprecher. Bei Bedarf zu einem lokalen Modell oder Dienst mit integrierter Sprechertrennung wechseln`,
  missingNote: (pack: string, size: string | null) => `Herunterladen: „${pack}“${size ? ` (${size})` : ""} zuerst, um Sprecher zu unterscheiden`,
  missingSummary: "Sprecher erkennen · zuerst das Modell herunterladen",
  onNote: "Nach der Transkription ordnet „Sprechertrennung“ jedem Satz seinen Sprecher zu; Untertitel und Transkripte enthalten die Namen",
  summaryOn: "Sprecher erkennen",
  offNote: "Sprecher werden nicht unterschieden; Untertitel und Transkripte enthalten keine Namen",
  summaryOff: "Sprecher nicht erkennen",

  downloading: (pack: string, pct: number | null) => `Wird heruntergeladen: „${pack}“${pct === null ? "…" : ` · ${pct}%`}`,
};
