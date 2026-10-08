import type { HarnessProjectsMessages } from './harness-projects.ts';

export const de: HarnessProjectsMessages = {
  conversationNotFound: (p: { id: string }) => `Sitzung nicht gefunden: ${p.id}`,
  projectNotFound: (p: { id: string }) => `Projekt nicht gefunden: ${p.id}`,
  folderInaccessible: (p: { dir: string }) => `Ordner nicht vorhanden oder nicht zugänglich: ${p.dir}`,
  markerReadFailed: (p: { error: string }) => `Projektmarkierung konnte nicht gelesen werden: ${p.error}`,
  markerNewer: (p: { version: number }) =>
    `Dieses Projekt wurde mit einer neueren BaoCut-Version erstellt (Version der Projektmarkierung ${p.version}). BaoCut aktualisieren und erneut öffnen`,

  untitledProject: "Unbenanntes Projekt", recoveredVideos: "Wiederhergestellte Videos",
  createFolderFailed: (p: { error: string }) => `Projektordner konnte nicht erstellt werden: ${p.error}`,
  tooManySameName: "Zu viele Projektordner mit diesem Namen. Einen anderen Namen auswählen",
  markerNotWritable: (p: { dir: string }) =>
    `Der Projektordner ist nicht beschreibbar. Die Projektmarkierung .bcut/project.json konnte daher nicht geschrieben werden: ${p.dir}`,
  markerWriteFailed: (p: { error: string }) => `Projektmarkierung konnte nicht geschrieben werden: ${p.error}`,
};
