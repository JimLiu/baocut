import type { MissingAsset } from "@baocut/protocol";
import { pluralForm } from '@baocut/protocol';
import type { StageMediaMessages } from './stage-media-copy.ts';

export const de: StageMediaMessages = {
  titles: {
    missing: "Quelldatei nicht gefunden",
    changed: "Die Quelldatei wurde geändert",
    'outside-project': "Die Quelldatei liegt außerhalb des Projektordners",
    unplayable: "Die Quelldatei ist nicht abspielbar",
  } satisfies Record<MissingAsset['reason'] | 'unplayable', string>,
  causes: {
    missing: "Datei möglicherweise verschoben, umbenannt, gelöscht oder auf einem getrennten Laufwerk.",
    changed: "Datei entspricht nicht mehr dem Import (Größe abweichend); möglicherweise überschrieben oder erneut exportiert.",
    'outside-project': "Gespeicherter Ort liegt außerhalb dieses Video-Projektordners; BaoCut liest dort keine Dateien.",
  } satisfies Record<MissingAsset['reason'], string>,
  unplayable: (error: string) => `Player kann diese Datei nicht öffnen: ${error}.`,

  tail: {
    video: "Untertitel spielen weiterhin; nur Bild und Originalton fehlen.",
    audio: "Untertitel spielen weiterhin; dieses Audio ist nicht hörbar.",
  },

  body: (cause: string, tail: string) => `${cause} ${tail}`,
  volume: (volume: string) => `Die Datei liegt auf „${volume}“. Laufwerk verbinden; automatische Wiederherstellung.`,
  more: (count: number) => `${count} weitere Video- oder Audiomaterialien ${pluralForm('de', count, { one: "Material", other: "Materialien" })} sind ebenfalls nicht abspielbar.`,
  relinkHint: "Originaldatei zur Wiederherstellung auswählen. BaoCut prüft den Inhalt; anderer Inhalt ist nicht neu verknüpfbar.",
  desktopOnly: "Video in der BaoCut-Desktop-App öffnen und auf der Arbeitsfläche „Erneut verknüpfen…“ wählen, um die Originaldatei auszuwählen.",
  managed: "Diese Datei liegt im Videoordner und kann nicht mit einem anderen Ort verknüpft werden.",
  oldRevision: "Zeitleiste verwendet eine ältere Materialversion; nur aktuelle Version ist neu verknüpfbar.",
  relink: "Neu verknüpfen…",
  relinking: "Überprüfen…",
  pickTitle: (name: string) => `Suchen: „${name}“`,
  pickButton: "Neu verknüpfen",
  label: (name: string) => `Erneut verknüpfen: „${name}“`,
  relinkFailed: (message: string) => `Erneutes Verknüpfen fehlgeschlagen: ${message}`,
  decodeFailed: "Decodierung fehlgeschlagen",
  unsupported: "Format nicht unterstützt",
};
