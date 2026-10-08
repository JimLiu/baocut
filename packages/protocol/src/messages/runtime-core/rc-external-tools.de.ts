import type { RcExternalToolsMessages } from './rc-external-tools.ts';

export const de: RcExternalToolsMessages = {
  manageOnlyInAppOrCli: "Externe Werkzeuge können nur in der Desktop-App oder CLI verwaltet werden",
  videoNotOpen: "Das Video ist nicht geöffnet",

  toolUpdating: (p: { label: string }) => `${p.label} wird aktualisiert`,
  waitForUpdate: (p: { jobId: string }) => `Erneut versuchen nach Abschluss der Aktualisierungsaufgabe ${p.jobId}`,
  toolNotInstalled: (p: { label: string }) => `${p.label} ist nicht installiert`,
  toolCannotRun: (p: { label: string; reason: string }) => `${p.label} kann nicht ausgeführt werden: ${p.reason}`,
  toolOutdated: (p: { label: string; reason: string }) => `${p.label} ist veraltet: ${p.reason}`,
  consentRevoked: (p: { label: string }) => `Einwilligung zur Nutzung von ${p.label} wurde zurückgezogen`,
  consentRequired: (p: { label: string }) => `Die Nutzung von ${p.label} benötigt zuerst die Einwilligung des Benutzers`,
  consentRemedy: (p: { name: string }) =>
    `Nach Einwilligung des Benutzers erneut versuchen: externalTools.consent (baocut external-tools consent ${p.name}) oder bei der Installation zustimmen (externalTools.install mit consent: true)`,

  notExecutable: (p: { path: string }) => `${p.path} ist keine ausführbare Datei`,
  notWindowsProgram: (p: { path: string }) =>
    `${p.path} ist kein Windows-Programm (.exe): BaoCut führt externe Werkzeuge nicht über einen Befehlsinterpreter aus`,
  cannotRunAs: (p: { path: string; label: string; reason: string }) => `${p.path} kann nicht ausgeführt werden als ${p.label}: ${p.reason}`,
  noVersion: "Version konnte nicht gelesen werden",
  toolInUse: (p: { label: string }) => `${p.label} wird gerade installiert oder von einer Aufgabe verwendet`,
  notDownloadedByBaocut: (p: { label: string; remedy: string }) => `BaoCut lädt nicht herunter: ${p.label}: ${p.remedy}`,
  downloadNeedsConsent: (p: { label: string }) =>
    `Das Herunterladen von ${p.label} benötigt die Einwilligung des Benutzers: zuerst Quelle, Version, Größe und Lizenz bestätigen`,
  offlineStrictNoDownload: "Im strikten Offlinemodus werden keine externen Werkzeuge heruntergeladen",
  cannotDownload: (p: { label: string; reason: string }) => `Herunterladen nicht möglich: ${p.label}: ${p.reason}`,
  manifestIncompleteRemedy: (p: { label: string }) =>
    `Auf eine Manifestaktualisierung durch BaoCut warten oder selbst installieren: ${p.label}; Pfad mit externalTools.setPath festlegen`,
  updateManagedCopy: (p: { label: string }) => `${p.label} ist eine von BaoCut heruntergeladene Kopie und wird daher nicht über das Installationsprogramm aktualisiert`,
  updateUnknownInstall: (p: { path: string }) => `Installationsart unbekannt für ${p.path}`,
  updateNoRunnable: (p: { label: string }) => `Keine funktionierende Installation von ${p.label} gefunden`,
  updateManagedRemedy: "Mit externalTools.install zur Version im Manifest wechseln",
  updateManualRemedy: "Im Terminal entsprechend der Installation aktualisieren, dann erneut erkennen (externalTools.detect)",
  cannotUpdateFor: (p: { label: string }) => `BaoCut kann nicht aktualisieren: ${p.label} für Sie`,
  runInTerminalRemedy: (p: { command: string }) => `Ausführen: ${p.command} im Terminal; danach erneut erkennen (externalTools.detect)`,
  confirmUpdateCommand: (p: { label: string; command: string }) => `Die Aktualisierung von ${p.label} benötigt zuerst die Bestätigung dieses Befehls durch den Benutzer: ${p.command}`,
  updateCommandChanged: (p: { label: string; command: string }) => `Der Aktualisierungsbefehl für ${p.label} hat sich geändert. Erneut bestätigen: ${p.command}`,
  offlineStrictNoUpdate: "Im strikten Offlinemodus werden externe Werkzeuge nicht aktualisiert",
  unknownTool: (p: { name: string }) => `Kein externes Werkzeug „${p.name}“`,
  notManaged: (p: { label: string; remedy: string }) => `BaoCut verwaltet nicht: ${p.label}: ${p.remedy}`,
  endpointInvalid: "Die Downloadquelle für externe Werkzeuge ist keine gültige Adresse",
  endpointBadForm:
    "Die Downloadquelle für externe Werkzeuge muss eine Basisadresse mit http(s):// sein, ohne Zugangsdaten, Abfrageparameter oder Fragment",

  sourceEnvVar: (p: { name: string }) => `die Umgebungsvariable ${p.name}`,
  sourceUserPath: "der von Ihnen festgelegte Pfad",
  sourceManaged: "die von BaoCut heruntergeladene Kopie",
  commandNotFound: (p: { command: string }) => `${p.command} nicht gefunden`,
  commandNotFoundIn: (p: { where: string; command: string }) => `${p.command} nicht gefunden in ${p.where}`,
  sourceNotExecutable: (p: { where: string }) => `${p.where} ist keine ausführbare Datei`,
  sourceIsScript: (p: { where: string; batch: boolean }) =>
    `${p.where} verweist auf ${p.batch ? "Batch-Skript" : "Skript"}, kein Windows-Programm (.exe); BaoCut führt externe Werkzeuge nicht über einen Befehlsinterpreter aus`,
  setExePathRemedy: (p: { command: string; canInstall: boolean }) =>
    `Pfad festlegen auf ${p.command}.exe mit externalTools.setPath${p.canInstall ? " oder mit externalTools.install herunterladen" : ""}`,
  belowMinVersion: (p: { version: string; min: string }) => `${p.version} ist älter als die Mindestversion ${p.min}`,
  installOrUpdateRemedy: (p: { version: string; label: string }) =>
    `Herunterladen: ${p.version} mit externalTools.install oder aktualisieren Sie ${p.label} auf Ihrem System`,
  updateTool: (p: { label: string }) => `Aktualisieren: ${p.label}`,

  diskFull: "Die Festplatte wurde beim Schreiben der Werkzeugdatei voll",
  downloadedCannotRun: (p: { label: string; reason: string }) => `Die heruntergeladene Datei ${p.label} kann nicht ausgeführt werden: ${p.reason}`,
  updateStopped: "Aktualisierung gestoppt",
  updateExited: (p: { code: string }) => `Der Aktualisierungsbefehl wurde beendet mit ${p.code}`,
  updateTimedOut: (p: { minutes: number }) => `Der Aktualisierungsbefehl wurde nicht abgeschlossen innerhalb von ${p.minutes} Minuten und wurde gestoppt`,
  updateSignalled: (p: { signal: string }) => `Der Aktualisierungsbefehl wurde durch dieses Signal beendet: ${p.signal}`,
  updateCannotStart: (p: { reason: string }) => `Der Aktualisierungsbefehl konnte nicht starten (${p.reason})`,
  updateFailedRemedy: (p: { command: string }) => `Ausgabe in der Aufgabe prüfen oder ausführen: ${p.command} im Terminal; danach erneut erkennen`,

  remedyNoSpace: "Die Festplatte mit Runtime Home ist voll. Speicher freigeben und erneut installieren",
  remedyNetwork:
    "Netzwerk nicht erreichbar oder Download unterbrochen. Netzwerk prüfen und erneut installieren (heruntergeladene Teile werden fortgesetzt) oder unter „Werkzeugdownloadquelle“ in Einstellungen › Allgemein einen anderen Spiegelserver wählen",
  remedyIntegrity:
    "Die heruntergeladene Datei stimmt in Größe oder sha256 nicht mit dem Manifest überein (falscher Inhalt von Quelle oder Spiegelserver). Die fehlerhafte Datei wurde gelöscht; eine andere Downloadquelle wählen und erneut installieren",
  remedySource:
    "Die Downloadquelle enthält diese Datei nicht oder verweigert den Zugriff. Den Spiegelserver unter „Werkzeugdownloadquelle“ in Einstellungen › Allgemein (oder die Umgebungsvariable BAOCUT_TOOLS_ENDPOINT) prüfen",
  downloadFailed: (p: { file: string; reason: string }) => `Das Herunterladen von ${p.file} fehlgeschlagen: ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `${p.file} stimmt in Größe oder sha256 nicht mit dem Manifest überein`,
  sourceHttpStatus: (p: { file: string; status: number }) => `Die Downloadquelle gab HTTP zurück: ${p.status} für ${p.file}`,
  largerThanManifest: (p: { file: string }) => `${p.file} ist größer als im Manifest angegeben`,

  ytDlpLicense: "Unlicense (Quellcode); das eigenständige Programm enthält GPLv3+-Komponenten und steht insgesamt unter GPLv3+",
  ytDlpPurpose: "Import über Link: liest die Videoseite und lädt Medien und Untertitel herunter",
  ytDlpMissingRemedy:
    "Mit externalTools.install herunterladen (baocut external-tools install yt-dlp) oder selbst installieren und den Pfad mit externalTools.setPath festlegen",
  ffmpegPurpose: "Medienanalyse, Dateitranscodierung, Exporte sowie Zusammenführen von Audio und Video nach Downloads",
  noReleaseForPlatform: (p: { platform: string }) => `Keine Releasedatei für diesen Computer (${p.platform})`,
  noTrustedSha: "Das integrierte Manifest enthält noch keinen vertrauenswürdigen sha256 für diese Datei; sie kann daher nicht heruntergeladen werden",

  probeCannotStart: (p: { error: string }) => `Start nicht möglich: ${p.error}`,
  probeTimeout: (p: { command: string; seconds: number }) => `${p.command} wurde nicht abgeschlossen innerhalb von ${p.seconds} Sekunden`,
  probeCannotStartCode: (p: { code: string }) => `Start nicht möglich (${p.code})`,
  probeExited: (p: { code: string; detail: string }) => `Beendet mit ${p.code}${p.detail ? `: ${p.detail}` : ""}`,

  pipxMissing: (p: { label: string }) => `Diese Sitzung mit ${p.label} wurde mit pipx installiert, aber pipx ist nicht in PATH.`,
  brewMissing: (p: { label: string; brew: string }) => `Diese Sitzung mit ${p.label} wurde mit Homebrew installiert, aber dessen Datei ${p.brew} wurde nicht gefunden.`,
  wingetMachineWide: (p: { label: string; dir: string }) =>
    `Diese Sitzung mit ${p.label} wurde mit winget für alle Benutzer installiert (${p.dir}) und benötigt zum Aktualisieren Administratorrechte; BaoCut erhöht die Rechte nicht für Sie. Terminal als Administrator öffnen und diesen Befehl ausführen.`,
  wingetMissing: (p: { label: string }) => `Diese Sitzung mit ${p.label} wurde mit winget installiert, aber winget ist nicht in PATH.`,
  scoopGlobal: (p: { label: string; dir: string }) =>
    `Diese Sitzung mit ${p.label} ist eine globale Scoop-Installation (${p.dir}) und benötigt zum Aktualisieren Administratorrechte; BaoCut erhöht die Rechte nicht für Sie. Terminal als Administrator öffnen und diesen Befehl ausführen.`,
  scoopMissing: (p: { label: string; script: string }) => `Diese Sitzung mit ${p.label} wurde mit Scoop installiert, aber Scoop selbst wurde nicht gefunden (${p.script}).`,
  chocolateyAdmin:
    "Mit Chocolatey installierte Programme benötigen zum Aktualisieren Administratorrechte; BaoCut erhöht die Rechte nicht für Sie. Terminal als Administrator öffnen und diesen Befehl ausführen.",
  pythonScriptMissing: "Der Python-Interpreter, auf den dieses Einstiegsskript verweist, ist nicht mehr vorhanden.",
  pipAdmin: (p: { label: string; dir: string }) =>
    `Diese Sitzung mit ${p.label} ist installiert in ${p.dir}; Änderungen benötigen Administratorrechte. BaoCut erhöht die Rechte nicht für Sie. Entsprechend der Installation aktualisieren.`,
  pythonLauncherMissing: "Der Python-Interpreter, auf den dieses Startprogramm verweist, ist nicht mehr vorhanden.",
  pipAdminWin: (p: { label: string; dir: string }) =>
    `Diese Sitzung mit ${p.label} ist installiert in ${p.dir}; Änderungen benötigen Administratorrechte. BaoCut erhöht die Rechte nicht für Sie. Terminal als Administrator öffnen und diesen Befehl ausführen.`,
  standaloneAdmin: (p: { label: string; dir: string }) =>
    `${p.dir}; dort liegt ${p.label} und Änderungen benötigen Administratorrechte. BaoCut erhöht die Rechte nicht für Sie.`,
  standaloneAdminWin: (p: { label: string; dir: string }) =>
    `${p.dir}; dort liegt ${p.label} und Änderungen benötigen Administratorrechte. BaoCut erhöht die Rechte nicht für Sie. Terminal als Administrator öffnen und diesen Befehl ausführen.`,
};
