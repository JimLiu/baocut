import { pluralForm } from '@baocut/protocol';
import type { ThreadMessages } from './thread-copy.ts';

export const de: ThreadMessages = {

  videoTools: {
    videos_list: "Videos auflisten",
    videos_create: "Neues Video",
    videos_inspect: "Video lesen",
    edits_apply: "Video bearbeiten",
    edits_undo: "Bearbeitungen rückgängig machen",
  } as Record<string, string>,

  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: "Befehl ausführen", read: "Datei lesen", edit: "Datei bearbeiten", search: "Suchen", other: "Anderes Werkzeug" },

  phrase: {
    command: "Befehle ausgeführt",
    read: (count: number) => `gelesen: ${count} ${pluralForm('de', count, { one: "Datei", other: "Dateien" })}`,
    edit: (count: number) => `bearbeitet: ${count} ${pluralForm('de', count, { one: "Datei", other: "Dateien" })}`,
    search: "gesucht",
    video: (count: number) => `gespeichert: ${count} Video ${pluralForm('de', count, { one: "Bearbeitung", other: "Bearbeitungen" })}`,
    tool: "Werkzeuge aufgerufen",
  },
  summary: (phrases: readonly string[]) => {
    const text = phrases.join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
  thinking: "Denkt nach",
  stepsFallback: "Schritte",
};
