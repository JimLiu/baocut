const count = (n: number, one: string, many: string) => `${n} ${pluralForm('de', n, { one, other: many })}`;
import { pluralForm } from '@baocut/protocol';
import { revealLabel } from '../../copy.ts';
import type { SpaceMessages } from './space-copy.ts';

export const de: SpaceMessages = {
  searchPlaceholder: "Namen, Dateien oder gesprochenen Videoinhalt suchen",
  searchLabel: "Space durchsuchen",

  openVideo: "Video öffnen",
  viewInfo: "Informationen anzeigen",
  transcribe: { first: 'Transkribieren…', redo: 'Neu transkribieren…', retry: 'Transkription wiederholen…' },
  info: "Videodetails…",
  view: "Ansehen",
  continue: "In Sitzung fortsetzen",
  favorite: "Favorisieren",
  unfavorite: "Aus Favoriten entfernen",
  rename: "Umbenennen",
  get reveal() {
    return revealLabel();
  },
  viewTask: "Aufgabe anzeigen",
  trash: "In Papierkorb verschieben",
  restore: "Aus Papierkorb wiederherstellen",
  purge: "Dauerhaft löschen",
  clear: "Löschen",
  columnMeasure: "Dauer oder Abmessungen",
  columnStatus: "Status",
  noValue: "–",
  favorited: "Favorisiert",

  statusPicker: "Status",
  refreshMenu: "Aktualisieren",
  rescan: "Projektordner erneut scannen",
  rescanHint: "Dateien aller Projekt- und Sitzungsordner erneut lesen",
  rebuild: "Index neu erstellen",
  rebuildHint: "Abgeleiteten Katalog und Inhaltsindex verwerfen und neu erstellen; Favoriten, Anzeigenamen und Papierkorb bleiben erhalten",
  scanning: "Projektordner werden gescannt",
  rebuilt: (entries: number, pending: number) =>
    pending > 0
      ? `Index neu erstellt · ${count(entries, "Eintrag", "Einträge")} · Inhaltsindex für ${count(pending, "Video", "Videos")} wird noch im Hintergrund aktualisiert`
      : `Index neu erstellt · ${count(entries, "Eintrag", "Einträge")}`,

  newLabel: "Neu",
  newBlank: "Neues leeres Video",
  newBlankHint: "Leeres 16:9-Video, sofort geöffnet; ohne Transkription oder Warteschlange",
  newFromFile: "Neues Video aus Datei",
  newFromFileHint: "Video oder Audio gelangt zum Home-Eingabefeld für Anweisungen; Bilder direkt in die Zeitleiste",
  newFromPackage: "Neues Video aus portablem Paket",
  newFromPackageHint: "Anderswo exportierte .baocut-Datei mit allen Materialien",
  pickPackageTitle: "Portables Paket auswählen",
  pickPackageButton: "Öffnen",
  pickPackageFilter: "Portables BaoCut-Paket",
  openPackage: "Als neues Video öffnen",
  packageBlocked: (reason: string) => `Als neues Video öffnen: ${reason}`,
  packageOpening: (name: string) => `Wird geöffnet: „${name}“…`,
  packageOpened: (name: string) => `Geöffnet: „${name}“ als neues Video`,
  importAssets: "Material importieren",
  importAssetsHint: "Dateien als Projektmaterial registrieren; externe Dateien werden nach imports/ des Projekts kopiert",
  whichProject: "Welches Projekt",
  noProject: "Zuerst in Home einen Projektordner öffnen",
  pickNotMedia: "Keine Video-, Audio- oder Bilddatei",
  createdFromFile: (name: string) => `Video erstellt: „${name}“ und Material platziert`,
  createdEmpty: (reason: string) => `Video erstellt, Material nicht platziert: ${reason}`,

  importTitle: "Material importieren",
  importProject: "Ins Projekt importieren",
  importHint:
    "Videos, Audio oder Bilder auswählen. Dateien im Projektordner werden vor Ort registriert; externe Dateien nach imports/ kopiert, Originale bleiben unverändert. Kein Video wird ergänzt.",
  importPick: "Dateien wählen…",
  importNoProject: "Noch keine Projekte; zuerst in Home einen Projektordner öffnen.",
  importing: "Wird importiert",

  factSource: "Quelle",
  factFile: "Datei",
  factMeasure: "Dauer oder Abmessungen",
  factSize: "Größe",
  factStatus: "Status",
  factActivity: "Letzte Aktivität",
  factConversation: "Quellsitzung",
  factGenerated: "Erzeugt",
  factVersion: "Version",
  factNote: "Notiz",
  viewConversation: "Quellsitzung anzeigen",
  close: "Schließen",
  editBlocked: (reason: string) => `Erneut bearbeiten: ${reason}`,
  continueBlocked: (reason: string) => `In Sitzung fortsetzen: ${reason}`,
  version: (frozen: string, current: string | null) =>
    current && current !== frozen ? `Videoversion ${frozen}; aktuelle Version ${current}` : `Videoversion ${frozen}`,
  missingTitle: "Diese Datei wurde nicht gefunden",

  missingFile: "Datei nicht gefunden",
  missingBody: "Der Eintrag bleibt erhalten. Sein Status wird wiederhergestellt, sobald die Datei zurück ist.",
  failedTitle: "Erzeugung fehlgeschlagen",
  failedBody: "Keine Datei erzeugt. Auf der Aufgabenseite Ursache prüfen und erneut versuchen oder bei Nichtgebrauch entfernen.",
  changedTitle: "Quellvideo inzwischen geändert",
  changedBody: "Dieses Ergebnis entspricht einer früheren Videoversion. Weiterhin nutzbar, aber nicht mehr dem aktuellen Video entsprechend.",
  reexport: "Aus dem Quellvideo erneut exportieren",
  noPreviewVideo: "Videos öffnen sich im Editor.",

  capability: {
    synthesizeSpeech: "Vertonung",
    generateImage: "Bild erzeugen",
    generateText: "Text erzeugen",
    export: "Exportieren",
  } as Record<string, string>,

  trashed: (name: string) => `In Papierkorb verschoben · ${name}`,
  undo: "Rückgängig machen",
  restored: (name: string) => `Wiederhergestellt · ${name}`,
  purged: (name: string) => `Dauerhaft gelöscht · ${name}`,
  cleared: (name: string) => `Entfernt · ${name}`,
  renamed: "Umbenannt",
  continued: (created: boolean, name: string, title: string) =>
    created
      ? `Neue Sitzung gestartet mit Anhang „${name}“: Anweisungen eingeben und senden`
      : `Zurück in „${title}“ mit „${name}“: Anweisungen eingeben und senden`,
  sourceGone: "Das Quellvideo liegt derzeit in keinem Projekt- oder Sitzungsordner und kann nicht geöffnet werden",

  failed: (what: string, reason: string) => `${what} fehlgeschlagen: ${reason}`,

  trashVideoTitle: "Dieses Video löschen?",
  trashVideoBody: "Der gesamte Videoordner gelangt in den Projektpapierkorb und ist wiederherstellbar. Verknüpfte Originalmaterialien bleiben unverändert.",
  trashVideoRelated: (n: number) =>
    `${count(n, "Eintrag", "Einträge")} daraus exportiert oder erzeugt bleiben in Space und werden nicht mit dem Video gelöscht:`,
  trashVideoConfirm: "Video löschen",

  purgeTitle: "Dauerhaft löschen?",
  purgeBody: (name: string) =>
    `“${name}“ wird von der Festplatte gelöscht und ist nicht wiederherstellbar. Bei Verwendung durch ein Video oder eine laufende Aufgabe wird nichts gelöscht; die Verwendung wird angezeigt.`,
  purgeVideoBody: (name: string) =>
    `Der gesamte Ordner des Videos „${name}“ wird von der Festplatte gelöscht und ist nicht wiederherstellbar. Verknüpfte Originalmaterialien bleiben unverändert.`,
  purgeConfirm: "Dauerhaft löschen",
  blockedTitle: "Noch nicht löschbar",
  blockedBody: (name: string) => `“${name}“ wird noch verwendet; nichts gelöscht:`,
  gotIt: "Verstanden",

  renameTitle: "Umbenennen",
  renameLabel: "Anzeigename",
  renameHint: (fileName: string) =>
    `Ändert nur den Namen in Space; die Datei bleibt unverändert. Leeren stellt wieder her: „${fileName}“.`,
  save: "Speichern",

  changedDialogTitle: "Das Quellvideo wurde geändert",
  changedDialogBody: (frozen: string | null, current: string | null) =>
    `Dieses Ergebnis entspricht Videoversion ${frozen ?? "(unbekannt)"}; aktuelle Version ${current ?? "(unbekannt)"}. Die aktuelle Arbeitskopie wird geöffnet.`,
  changedOpenCurrent: "Aktuelle Arbeitskopie öffnen",
  changedFromFrozen: "Von dieser Version fortsetzen",
  changedFromFrozenReason:
    "Fortsetzen von der Exportversion ist noch nicht möglich (Runtime hat keinen Befehl zum Versionswechsel). Aktuelle Arbeitskopie öffnen und diese Version im Verlauf ansehen.",

  hitsTitle: "In Videos gesprochen",
  hitsCount: (n: number) => count(n, "Treffer", "Treffer"),
  hitsSearching: "Inhaltsindex wird durchsucht",
  hitsNone: "Keine passenden gesprochenen Videoinhalte",
  hitsError: (reason: string) => `Inhaltsindex kann nicht durchsucht werden: ${reason}`,
  hitUnopenable: "Dieses Video liegt derzeit in keinem Projekt- oder Sitzungsordner oder im Papierkorb und kann nicht geöffnet werden",
  hitSourceClock: "Dies liegt im Material, nicht in der Zeitleiste; Video öffnen und danach suchen",
  hitStale: "Video nach Indexierung geändert; Position möglicherweise abweichend",

  hitsGrouped: (n: number, videos: number) => `${count(n, "Treffer", "Treffer")} · ${count(videos, "Video", "Videos")}`,
  hitKind: "Dokumentart",
  hitKindAll: "Alle Arten",
  hitSpeaker: "Sprecher",
  hitSpeakerAll: "Alle Sprecher",
  hitSpeakerNone: "Keiner dieser Treffer hat einen Sprecher",
  hitsNoneFiltered: "Keine passenden Treffer für Art oder Sprecher. Andere Auswahl versuchen.",
  hitsMore: (n: number) => `Einblenden: ${n} weitere`,

  cancel: "Abbrechen",
  openForEdit: "Zum Bearbeiten öffnen",
  newVideo: "Neues Video",
  revealUnavailable: "Diese Datei liegt in keinem Projekt- oder Sitzungsordner; kein Speicherort anzeigbar",
  sidebarLabel: "Space-Kategorien",
  kindsHeader: "Kategorien",
  mineHeader: "Organisieren",
  sidebarNote: "Space zeigt Videos, Materialien und Ergebnisse aller Projekte. Dateien bleiben in ihren Projektordnern.",
  all: "Alle",
  emptyFiltered: "Keine passenden Einträge",
  emptyTrash: "Papierkorb ist leer",
  emptyFavorite: "Noch keine Favoriten",
  emptyAll: "Noch keine Einträge",

  emptyCategory: (label: string) => `Keine Einträge in ${label} noch`,
  emptyFilteredBody: "Andere Suchbegriffe versuchen oder Projekt- und Statusfilter leeren.",
  emptyTrashBody: "Hier erscheinen Papierkorbeinträge. Wiederherstellen oder dauerhaft löschen.",
  emptyBody: "Den Agenten in einer Sitzung beauftragen; seine Ergebnisse erscheinen hier. Materialien auch über „Neu“ importierbar oder einen vorhandenen Ordner in Home öffnen.",
  projectPicker: "Projekt",
  allProjects: "Alle Projekte",
  sortPicker: "Sortieren",
  viewPicker: "Ansehen",
  viewGrid: "Raster",
  viewList: "Liste",
  issuesTitle: (n: number) => (pluralForm('de', n, { one: "1 Ordner wurde nicht vollständig aufgelistet", other: `${n} Ordner wurden nicht vollständig aufgelistet` })),
  issueTruncated: (detail: string) => `Zu viele Dateien; nur teilweise aufgelistet: ${detail}`,
  issueUnreadable: (detail: string) => `Lesen fehlgeschlagen: ${detail}`,
  preparing: "Space wird vorbereitet…",
  preparingBody: "Beim ersten Mal müssen Projektordner gescannt werden. Dies dauert einen Moment.",

  createIn: (project: string, hint: string) => `In „${project}“ · ${hint}`,

  whichProjectFor: (label: string) => `${label}: welches Projekt`,
  entryActions: (name: string) => `Aktionen für „${name}“`,
  entriesLabel: "Space-Einträge",
  columnName: "Name",
  columnKind: "Typ",
  columnSource: "Quelle",
  columnActivity: "Letzte Aktivität",
  columnMenu: "Aktionen",

  relatedMore: (n: number) => `…${n} insgesamt`,

  importSummaryIn: (text: string, project: string) => `${text} (${project})`,

  activityAt: (ago: string, at: string) => `${ago} (${at})`,

  withReason: (reason: string, body: string) => `${reason}. ${body}`,
};
