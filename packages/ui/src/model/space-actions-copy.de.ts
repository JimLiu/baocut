import type { SpaceReference } from "@baocut/protocol";
import { pluralForm } from '@baocut/protocol';
import type { SpaceActionsMessages } from './space-actions-copy.ts';

export const de: SpaceActionsMessages = {
  edit: {
    video: "Video öffnen",
    'source-video': "Im Quellvideo bearbeiten",
    'new-video': "Neues Video aus diesem Material",
    text: "Text bearbeiten",
    version: "Kopie speichern und bearbeiten",
  },
  trashed: "Diesen Eintrag zuerst aus dem Papierkorb wiederherstellen",
  editGenerating: "Wird noch erzeugt; nach Abschluss bearbeitbar",
  editMissing: "Datei nicht gefunden; vor Bearbeitung erneut verbinden",
  editFailed: "Erzeugung fehlgeschlagen; keine bearbeitbare Datei",
  editPackage: "Videopakete (portable Pakete) sind nicht bearbeitbar",
  editText: "Eine neue Textversion kann hier noch nicht gespeichert werden; in einer Sitzung vom Agenten ändern lassen",
  editVersion: "Manuelle Bild-, Audio- und Vorlagenbearbeitung noch nicht verfügbar; in einer Sitzung vom Agenten ändern lassen",
  newVideoOutside: "Diese Datei liegt in keinem Projekt- oder Sitzungsordner; noch nicht für ein neues Video verwendbar",
  packageGenerating: "Wird noch exportiert; nach Abschluss öffnen",
  packageMissing: "Diese Datei wurde nicht gefunden",
  packageFailed: "Export fehlgeschlagen; kein Paket zum Öffnen",
  packageOutside: "Dieses Paket liegt in keinem Projekt- oder Sitzungsordner und ist noch nicht öffnbar",
  continueTrashed: "Vor Übernahme in eine Sitzung aus dem Papierkorb wiederherstellen",
  purgeGenerating: "Aufgabe läuft noch; zuerst auf der Aufgabenseite abbrechen",
  purgeNotTrashed: "Zuerst in Papierkorb verschieben, dann daraus löschen",
  referenceKind: {
    'video-asset': "Videomaterial",
    job: "Laufende Aufgabe",
    unverified: "Nicht bestätigbar",
    'user-file': "Andere Dateien im Videoordner",
  } satisfies Record<SpaceReference['kind'], string>,
  importAllFailed: (count: number, error: string) => `Keine der ${count} Dateien wurde importiert: ${error}`,
  importFailed: (error: string) => `Nicht importiert: ${error}`,
  imported: (count: number) => `Importiert: ${count} ${pluralForm('de', count, { one: "Material", other: "Materialien" })}`,
  copiedAll: "nach imports/ des Projekts kopiert",
  copiedSome: (count: number) => `${count} nach imports/ des Projekts kopiert`,
  notImported: (count: number) => `${count} nicht importiert`,

  references: (names: readonly string[], total: number) => {
    const quoted = names.map((name) => `„${name}“`).join(", ");
    return total > names.length ? `Space-Einträge ${quoted} und ${total - names.length} weitere` : `Space ${pluralForm('de', total, { one: "Eintrag", other: "Einträge" })} ${quoted}`;
  },
  referenceOutput: "Ergebnis",
};
