import { pluralForm } from '@baocut/protocol';
import type { ThreadMessages } from './thread-copy.ts';

export const de: ThreadMessages = {

  withDetail: (text: string, detail: string) => `${text} (${detail})`,
  copy: "Kopieren",
  copied: "Kopiert",
  copyFailed: "Kopieren fehlgeschlagen. Erneut versuchen",
  copyCode: "Code kopieren",
  copyReply: "Diese Antwort kopieren",
  change: {
    added: (n: number) => `Hinzugefügt: ${n}`,
    updated: (n: number) => `Geändert: ${n}`,
    deleted: (n: number) => `Gelöscht: ${n}`,
    duration: (clock: string) => `Dauer ${clock}`,
    durationChange: (before: string, after: string) => `Dauer ${before} → ${after}`,
    revision: (before: number | string, after: number | string) => `Version ${before} → ${after}`,
    locked: "Das Video kann derzeit nicht geändert werden",
    undoStep: (videoName: string, label: string) => `Schritt rückgängig gemacht in „${videoName}“: ${label}`,
    changed: (videoName: string, label: string) => `Geändert: „${videoName}“: ${label}`,
    aria: (label: string) => `Videoänderung: ${label}`,
  },
  message: {
    contextTitle: "Mit der Nachricht gesendeter Editorzustand",
    context: (videoName: string, revision: number | string, playhead: string, selected: number) =>
      `„${videoName}“ · Version ${revision} · Abspielkopf ${playhead}${selected ? ` · ${selected} ${pluralForm('de', selected, { one: "Clip", other: "Clips" })} ausgewählt` : ""}`,
  },
  output: {
    aria: (name: string, detail: string) => `${name}, ${detail}`,
  },
  steps: {
    more: (n: number) => `${n} laufen`,
    failed: (n: number) => `${n} fehlgeschlagen`,
    thinking: "Denkt nach",
    viewFile: (name: string) => `Anzeigen: ${name}`,
    input: "Eingabe",
    error: "Fehler",
    output: "Ergebnis",
    waiting: "Wartet auf Ausgabe",
    noOutput: "Keine Ausgabe",
  },
};
