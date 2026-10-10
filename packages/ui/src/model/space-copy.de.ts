import type { SpaceEntryKind } from "@baocut/protocol";
import type { SpaceEntryStatus } from "@baocut/protocol";
import type { SpaceMessages } from './space-copy.ts';

export const de: SpaceMessages = {
  kind: {
    video: "Video",
    export: "Exportieren",
    'video-file': "Videomaterial",
    image: "Bild",
    audio: "Audio",
    subtitle: "Untertitel",
    document: "Dokument",
    package: "Videopaket",
    template: "Vorlage",
  } satisfies Record<SpaceEntryKind, string>,
  categoryAll: "Alle",
  favorite: "Favoriten",
  trash: "Papierkorb",
  sort: { created: 'Erstellungsdatum', updated: 'Aktualisierungsdatum', recent: "Letzte Aktivität", name: "Name", kind: "Typ" },
  status: {
    generating: "Wird erzeugt",
    candidate: "Kandidat",
    applied: "Übernommen",
    published: "Veröffentlicht",
    'source-changed': "Quelle geändert",
    missing: "Fehlt",
    failed: "Fehlgeschlagen",
  } satisfies Record<SpaceEntryStatus, string>,
  statusAny: "Alle Statuswerte",
  statusNone: "Kein Status",
  noProject: "Nicht in einem Projekt",
  removedProject: "Entferntes Projekt",
  conversation: (title: string) => `Sitzung „${title}“`,
  kindCount: (kind: string, n: number) => `${kind} ${n}`,
  foundFiles: (name: string, n: number) => (n === 1 ? `Treffer: ${name}` : `Treffer: ${name} und ${n - 1} weitere`),
  fileStatus: (kind: string, status: string) => `${kind}: ${status}`,
  filesStatus: (n: number, status: string) => `${n} ${n === 1 ? 'Datei' : 'Dateien'}: ${status}`,
};
