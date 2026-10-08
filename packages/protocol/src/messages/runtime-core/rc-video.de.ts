import type { RcVideoMessages } from './rc-video.ts';

export const de: RcVideoMessages = {

  engineExited: "Die Video-Engine wurde beendet; die Änderung wurde möglicherweise nicht übernommen. Mit demselben Befehl erneut versuchen",
  engineStartFailed: (p: { reason: string }) => `Video-Engine konnte nicht gestartet werden: ${p.reason}`,
  engineNotRunning: "Die Video-Engine läuft nicht",
  engineRequestFailed: (p: { method: string }) => `Die Engine konnte nicht verarbeiten: ${p.method}`,
  engineRestarting: "Die Video-Engine wird neu gestartet. Gleich mit demselben Befehl erneut versuchen",
  runtimeStopping: "Runtime wird gestoppt",
  engineNotFound: "Video-Engine (engine-host) nicht gefunden. Zuerst npm run build:engine ausführen",


  defaultDirName: "Video",
  untitledVideo: "Unbenanntes Video",
  sourceDirNotFound: "Der Quellordner ist nicht vorhanden",
  reservedDirOutsideSource: "Der reservierte Ordner liegt nicht im Quellordner",
  videoInUse: "Dieses Video ist geöffnet",
  videoNotOpenOpenFirst: "Das Video ist nicht geöffnet. Zuerst öffnen",
  assetVersionNotFound: "Das Material oder diese Version ist nicht vorhanden",
  videoNotFound: "Das Video ist nicht vorhanden",
  onlyWorkspaceVideos: "Nur Videos im Arbeitsordner können geöffnet werden",
  videoDeletedRestoreFromTrash: "Dieses Video wurde gelöscht. Zuerst aus dem Papierkorb wiederherstellen",
  dirNotVideo: "Dieser Ordner ist kein Video",
  linkedPreviewUnsupported: "Nur verknüpfte Bilder, Audio, Video, Schriften und Lottie-Animationen können als Vorschau angezeigt werden",
  packageNotFound: "Das portable Paket ist nicht vorhanden",
  packageNotFile: "Das portable Paket muss eine .baocut-Datei sein",
  videoInTrash: "Dieses Video liegt im Papierkorb. Zuerst wiederherstellen",
  videoNotInSourceDir: "Das Video liegt nicht in einem Projekt- oder Sitzungsordner",
  cantCreateInSession: "Diese Runtime kann keine Videos in einer Sitzung erstellen",
  targetLocationIncomplete: "Der Speicherort des Zielvideos ist unvollständig",
  reservedDirOutsideProject: "Der reservierte Ordner liegt nicht in diesem Projekt- oder Sitzungsordner",
  pipelinePrincipalName: "Pipeline",

  openElsewhere: "Dieses Video ist in einem anderen Fenster oder einer anderen Verbindung geöffnet. Dort zuerst schließen",
  videoBusy: "Dieses Video hat noch laufende Aufgaben oder Exporte. Zuerst abbrechen",
  crossDevice: "Videoordner und Quellordner liegen nicht auf derselben Festplatte; Verschieben in den Papierkorb ist daher nicht möglich",
  videoEntryNotFound: "Dieses Video wurde nicht gefunden (nicht in Space oder Scan läuft noch)",
  notDeletedVideo: "Dieser Eintrag ist kein gelöschtes Video",
  restoreRootGone: "Projekt oder Sitzung dieses Videos ist nicht mehr vorhanden; Wiederherstellung ist daher nicht möglich",
  trashDirGone: "Der Videoordner im Papierkorb ist nicht mehr vorhanden",
  sourceRootInTrash:
    "Dieser Videoordner ist ein Projektordner oder Arbeitsordner einer Sitzung (oder enthält einen); er kann daher nicht in den Papierkorb verschoben werden",
  sourceRootRemedy:
    "In BaoCut zuerst das Projekt oder die Sitzung entfernen, die diesen Ordner verwendet, dann dieses Video aus dem übergeordneten Projekt löschen",
  compositionImportFailed: (p) => `Die Motion-Grafik konnte nicht importiert werden (${p.code})`,
  compositionPreviewFailed: (p) => `Die Vorschau der Motion-Grafik ist fehlgeschlagen (${p.code})`,
};
