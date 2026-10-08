import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const de: ToolSpaceInputMessages = {
  reasons: {
    trashed: "Im Papierkorb",
    generating: "Wird noch erzeugt; nach Abschluss auswählbar",
    missing: "Die Datei fehlt; vor der Auswahl erneut verbinden",
    failed: "Die letzte Erzeugung ist fehlgeschlagen",
    textOnly: "Nur Text aus .txt- und .md-Dokumenten kann gelesen werden",
    subtitleOnly: "Nur .srt- und .vtt-Untertitel werden akzeptiert",
    noPath: "Dieser Eintrag hat keine Datei auf diesem Computer; ein neues Video muss mit einer lokalen Datei beginnen",
  },
  joinKinds: (labels: readonly string[]) => labels.join(", "),
};
