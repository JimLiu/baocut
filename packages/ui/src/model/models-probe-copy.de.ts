import { pluralForm } from '@baocut/protocol';
import type { ModelsProbeMessages } from './models-probe-copy.ts';

export const de: ModelsProbeMessages = {

  speechText: "Hallo, dies ist ein BaoCut-Sprachsynthesetest.",
  noResult: "Aufgabe abgeschlossen, aber kein Ergebnis zurückgegeben.",
  failed: "Aufgabe fehlgeschlagen.",
  cancelled: "Aufgabe abgebrochen.",
  interrupted: "Runtime neu gestartet; Test nicht abgeschlossen.",
  unknownOutcome: "Runtime vor Antwort auf diesen Aufruf neu gestartet; Ergebnis unbekannt.",

  audioFacts: (seconds: string, khz: number, type: string) => `${seconds} s · ${khz} kHz · ${type}`,
  videoFacts: (width: number, height: number, seconds: string, type: string) => `${width} × ${height} · ${seconds} s · ${type}`,
  textFacts: (entries: number, seconds: string, type: string) => `${pluralForm('de', entries, { one: "Eintrag", other: "Einträge" })} · ${seconds} s · ${type}`,
  packageFacts: (files: number, type: string) => `${pluralForm('de', files, { one: "Datei", other: "Dateien" })} · ${type}`,
  projectFacts: (clips: number, seconds: string, type: string) => `${pluralForm('de', clips, { one: "Clip", other: "Clips" })} · ${seconds} s · ${type}`,

  chars: (count: string) => `${count} Zeichen`,
  inputTokens: (count: string) => `${count} Eingabe-Token`,
  outputTokens: (count: string) => `${count} Ausgabe-Token`,
  hitLimit: "Ausgabelimit erreicht",
  filtered: "Vom Inhaltsfilter des Anbieters blockiert",

  untested: "Nicht getestet",
  testing: "Wird getestet…",
  passed: "Test bestanden",
  passedIn: (seconds: number) => `Test bestanden · ${seconds} s`,
};
