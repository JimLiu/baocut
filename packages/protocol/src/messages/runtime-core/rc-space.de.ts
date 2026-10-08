import type { RcSpaceMessages } from './rc-space.ts';

export const de: RcSpaceMessages = {

  dirUnreadable: (p: { code: string }) => `Ordner konnte nicht gelesen werden (${p.code})`,
  tooManyDirEntries: (p: { max: number }) => `Mehr als ${p.max} Ordnereinträge; nur ein Teil wird gelistet`,
  tooManyFiles: (p: { max: number }) => `Mehr als ${p.max} Dateien; nur ein Teil wird gelistet`,

  entryGone: "Dieser Eintrag ist nicht mehr in Space vorhanden",
  trashVideoUseDelete: "Zum Löschen eines Videos videos.delete verwenden",
  restoreVideoUseRestore: "Zum Wiederherstellen eines gelöschten Videos videos.restore verwenden",
  videoDeletedRestoreFirst: "Dieses Video wurde gelöscht. Zuerst wiederherstellen",
  videoDeleted: "Dieses Video wurde gelöscht",
  notInSourceDir: "Dieser Eintrag liegt nicht in einem Projekt- oder Sitzungsordner",
  stillGeneratingNoFile: "Wird noch erzeugt; noch keine Datei vorhanden",
  noReadableFile: "Dieser Eintrag hat keine lesbare Datei",
  entryStillGeneratingNoFile: "Dieser Eintrag wird noch erzeugt; noch keine Datei vorhanden",
  entryInTrash: "Dieser Eintrag liegt im Papierkorb. Zuerst wiederherstellen",
  entryKindNotAccepted: (p: { kind: string }) => `Ein Eintrag vom Typ ${p.kind} kann hier nicht verwendet werden`,
  notVideo: "Dieser Eintrag ist kein Video",

  projectNotFound: "Das Projekt ist nicht vorhanden",
  needAbsolutePath: "Absoluten Dateipfad angeben",
  fileNotFound: "Die Datei ist nicht vorhanden",
  unrecognizedFileType:
    "Dateityp nicht erkennbar. Nur Video-, Bild-, Audio-, Untertitel- und Dokumentdateien können hinzugefügt werden",
  projectDirNotFound: "Der Projektordner ist nicht vorhanden",
  hiddenDirFile: "Dateien in versteckten Ordnern oder Abhängigkeitsordnern können nicht hinzugefügt werden",
  videoDirFile: "Dateien in einem Videoordner gehören zum Video und können nicht einzeln hinzugefügt werden",
  tooManySameName: "Zu viele Dateien mit gleichem Namen in imports/ des Projekts",

  purgeVideoDeleteFirst:
    "Das Video zuerst löschen (videos.delete), um es in den Papierkorb zu verschieben; dann aus dem Papierkorb dauerhaft löschen",
  purgeTaskRunning: "Die Aufgabe läuft noch. Zuerst abbrechen (jobs.cancel)",
  purgeNotTrashed: "Zuerst in den Papierkorb verschieben, dann daraus löschen",
  videoSourceGone: "Die Quelle dieses Videos ist nicht mehr vorhanden",
  refRunningTaskUsesVideo: (p: { jobId: string }) => `Aufgabe ${p.jobId} läuft und verwendet dieses Video`,
  refTaskAwaitsDecision: (p: { jobId: string }) =>
    `Aufgabe ${p.jobId} hat Ergebnisse, bei denen Sie entscheiden müssen, ob sie diesem Video hinzugefügt werden`,

  refStrayFiles: (p: { names: string; total: number }) =>
    `Der Videoordner enthält Dateien, die das Video nicht verwaltet (${new Intl.ListFormat("de", { style: "long", type: "conjunction" }).format(p.names.split("/"))}${p.total > 3 ? `, ${p.total} insgesamt` : ""}). Video wiederherstellen und diese vor dem Löschen herausverschieben`,
  refRunningTaskUsesOutput: (p: { jobId: string }) => `Aufgabe ${p.jobId} läuft und verwendet dieses Ergebnis`,
  refVideoUnreadable: (p: { dir: string }) =>
    `Video ${p.dir} kann derzeit nicht gelesen werden (oder sein Index wird noch aktualisiert); es kann daher nicht bestätigt werden, dass es diese Datei nicht verwendet`,
  refVideoAssetLinks: (p: { video: string; asset: string }) => `Material „${p.asset}“ im Video „${p.video}“ verknüpft diese Datei`,

  importedFileGone: "Die hinzugefügte Datei liegt nicht mehr im Projektordner",
  resultNotApplied: "Das Ergebnis wurde nicht auf das Video angewendet",
  taskNotFinished: "Die Aufgabe wurde nicht abgeschlossen",
  outputFileGone: "Die Ergebnisdatei ist nicht mehr vorhanden",
  exportedFileGone: "Die exportierte Datei ist nicht mehr vorhanden",
  labelSynthesizeSpeech: "Synthetisierte Sprache",
  labelGenerateImage: "Erzeugtes Bild",
  labelGenerateText: "Erzeugter Text",
  labelExport: "Exportieren",

  engineUnavailable: "Die Video-Engine ist nicht verfügbar",
  continueFromTrash: "Einträge im Papierkorb können nicht fortgesetzt werden. Zuerst wiederherstellen",
  conversationCantSee:
    "Diese Sitzung kann diesen Eintrag nicht sehen. Projekteinträge müssen in eine Sitzung desselben Projekts gehen",
  serviceUsesMcp: "Externe Dienste greifen über MCP-Werkzeuge auf Space zu",
  materialTextOnly: (p: { fileName: string }) =>
    `Nur Text aus .txt- und .md-Dokumenten sowie .srt- und .vtt-Untertiteln kann gelesen werden: ${p.fileName}`,
  materialTooLarge: (p: { fileName: string; bytes: number; limit: number }) =>
    `${p.fileName} ist ${p.bytes} Bytes, über dem Materiallimit von ${p.limit}`,
  afterMaterial: (p: { reason: string }) => `Nach Hinzufügen des Materials: ${p.reason}`,
  invalidParams: "Ungültige Parameter",
};
