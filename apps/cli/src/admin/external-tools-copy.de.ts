import type { ExternalToolStatus, ExternalToolUpdateMethod } from '@baocut/protocol';
import type { ToolsMessages } from './external-tools-copy.ts';



export const de: ToolsMessages = {

  help: `Verwendung:
  baocut external-tools [list]     Externe Werkzeuge (yt-dlp, ffmpeg): Status, Version, Pfad,
                                   Quelle und Ihre Zustimmung zur Verwendung
  baocut external-tools detect [name]
                                   Erneut erkennen
  baocut external-tools install <name> [--yes]
                                   Verwaltete Kopie nach tools/ im Runtime-Home herunterladen: Quelle, Version, Größe und
                                   Lizenz auflisten, nach Bestätigung herunterladen und sha256 prüfen (--yes bedeutet Zustimmung).
                                   Downloadquelle: Einstellung tools.downloadEndpoint und Umgebungsvariable BAOCUT_TOOLS_ENDPOINT
  baocut external-tools update <name> [--yes]
                                   Systemkopie gemäß ihrer Installation aktualisieren (Homebrew, pipx, pip oder offizielles
                                   eigenständiges Programm): Vollständigen Befehl anzeigen, den die Runtime nach Bestätigung
                                   ausführt (--yes bestätigt); Ausgabe zeilenweise anzeigen und nach Abschluss erneut erkennen.
                                   Befehle mit erforderlichen Administratorrechten werden nur angezeigt; führen Sie sie selbst im Terminal aus
  baocut external-tools path <name> <file>|--clear
                                   Selbst installierte Kopie verwenden (einmal --version zur Prüfung ausführen); --clear entfernt die Überschreibung
  baocut external-tools remove <name>
                                   Verwaltete Kopie löschen (Systemkopien und Überschreibungen bleiben unverändert)
  baocut external-tools consent <name> [--revoke]
                                   Der Verwendung eines Downloadwerkzeugs zustimmen oder die Zustimmung zurückziehen (danach werden Linkimporte abgelehnt)`,
  usage:
    "Verwendung: baocut external-tools [list] | detect [name] | install <name> [--yes] | update <name> [--yes] | path <name> <file>|--clear | remove <name> | consent <name> [--revoke]",
  clearOrFile: "Geben Sie entweder --clear oder eine Datei an, nicht beides",
  stateLabels: {
    installed: "Installiert",
    missing: "Nicht installiert",
    outdated: "Update verfügbar",
    unavailable: "Nicht verfügbar",
  } satisfies Record<ExternalToolStatus["state"], string>,
  sourceLabels: {
    system: "System-PATH",
    user: "angegebener Pfad",
    managed: "von BaoCut heruntergeladene Kopie",
    env: "Umgebungsvariable",
  } satisfies Record<NonNullable<ExternalToolStatus["source"]>, string>,
  updateMethodLabels: {
    homebrew: "Homebrew",
    pipx: "pipx",
    pip: "pip",
    standalone: "offizielle eigenständige Version",
    winget: "winget",
    scoop: "Scoop",
    chocolatey: "Chocolatey",
  } satisfies Record<ExternalToolUpdateMethod, string>,
  statusHead: (name: string, state: string, version: string | null, source: string | null, purpose: string) =>
    `${name}  ${state}${version ? ` ${version}` : ""}${source ? ` (${source})` : ""}  ${purpose}`,
  pathLine: (path: string) => `  Pfad: ${path}`,
  userPathLine: (path: string) => `  Angegebener Pfad: ${path}`,
  managedLine: (version: string, path: string) => `  Verwaltete Kopie: ${version}  ${path}`,
  consentLine: (label: string) => `  Zustimmung: ${label}`,
  installingLine: (jobId: string) => `  Installation: Auftrag ${jobId}`,
  updatingLine: (jobId: string) => `  Aktualisierung: Auftrag ${jobId}`,
  updateLine: (command: string, method: string, runnable: boolean) =>
    `  Aktualisierung: ${command} (${method}${runnable ? "" : ", führen Sie dies selbst in einem Terminal aus"})`,
  reasonLine: (reason: string) => `  Grund: ${reason}`,
  remedyLine: (remedy: string) => `  Abhilfe: ${remedy}`,
  consentMissing: (name: string) => `Noch nicht erteilt (vor der Verwendung zustimmen: baocut external-tools consent ${name})`,
  consentVia: { agent: "über die Genehmigung des Agenten", cli: "in der CLI", app: "in der App" },
  consentGranted: (at: string, via: string) => `Erteilt (${at}, ${via})`,
  consentRevoked: (at: string) => `Zurückgezogen (${at})`,
  noTools: "Keine externen Werkzeuge registriert",
  cannotUpdate: (label: string, reason: string) => `Kann ${label} nicht für Sie aktualisieren: ${reason}`,
  runInTerminal: "Führen Sie dies in einem Terminal aus:",
  redetect: (name: string) => `Prüfen Sie anschließend erneut: baocut external-tools detect ${name}`,
  updatePlanHead: (method: string, label: string, version: string | null) =>
    `Aktualisiert ${label}${version ? ` ${version}` : ""} gemäß der ursprünglichen Installation (${method})`,
  runLine: (command: string) => `  Ausführen: ${command}`,
  updatePrompt: (label: string) => `Diesen Befehl auf diesem Computer ausführen, um ${label} zu aktualisieren? [y/N] `,
  omittedLines: (n: number) => `…(${n} ${n === 1 ? "Zeile" : "Zeilen"} ausgelassen)`,
  updated: (label: string, before: string | null, after: string) => `Aktualisiert: ${label}: ${before ?? "unbekannte Version"} → ${after}`,
  upToDate: (label: string, version: string | null) => `${label} ist aktuell${version ? ` (${version})` : ""}`,
  sizeEstimated: (size: string) => `etwa ${size} (Größe unbekannt, geschätzt)`,
  sizeAbout: (size: string) => `etwa ${size}`,
  willDownload: (label: string, version: string) => `Lädt ${label} ${version}`,
  sourceLine: (url: string | null) => `  Quelle: ${url ?? "(keine Datei für diesen Computer verfügbar)"}`,
  sizeLine: (size: string) => `  Größe: ${size}`,
  licenseLine: (license: string) => `  Lizenz: ${license}`,
  homepageLine: (url: string) => `  Homepage: ${url}`,
  sha256Line: (hash: string) => `  sha256: ${hash}`,
  blockedLine: (reason: string) => `  Download nicht möglich: ${reason}`,
  installPrompt: (label: string, version: string, size: string) => `Herunterladen und verwenden: ${label} ${version} (${size})? [y/N] `,
  noExternalTool: (name: string) => `Kein externes Werkzeug „${name}“`,
  alreadyInstalling: (jobId: string) => `Installation läuft bereits (Auftrag ${jobId}); Fortschritt wird angezeigt`,
  installDone: "Installation abgeschlossen",
  notDownloadedByBaoCut: (label: string, remedy: string | null | undefined) => `BaoCut lädt nicht herunter: ${label}: ${remedy ?? "selbst installieren"}`,
  cannotDownload: (label: string, reason: string | null) => `Herunterladen nicht möglich: ${label}: ${reason}`,
  notTtyAgreeDownload: "Kein Terminal: Fügen Sie --yes hinzu, sobald der Benutzer dem Download zustimmt",
  notTtyConfirmRun: "Kein Terminal: Fügen Sie --yes hinzu, sobald der Benutzer die Ausführung bestätigt",
  notDownloaded: "Nicht heruntergeladen",
  notRun: "Nicht ausgeführt",

  remedy: (remedy: string) => `Abhilfe: ${remedy}`,
  partialDownloadKept: (name: string) => `Der heruntergeladene Teil bleibt erhalten: Führen Sie baocut external-tools install ${name} aus, um fortzufahren`,
  alreadyUpdating: (jobId: string) => `Aktualisierung läuft bereits (Auftrag ${jobId}); Ausgabe wird angezeigt`,
  managedCopy: (label: string, name: string) =>
    `${label} ist eine von BaoCut heruntergeladene Kopie: Verwenden Sie baocut external-tools install ${name}, um die Version zu wechseln`,
  unknownInstall: (file: string, name: string) =>
    `Die Installationsart von ${file} lässt sich nicht ermitteln: Aktualisieren Sie es in einem Terminal gemäß der ursprünglichen Installation und führen Sie anschließend baocut external-tools detect ${name}`,
  noRunnableTool: (label: string, remedy: string) => `Keine ausführbare Version von ${label} gefunden: ${remedy}`,
  updateManual: (label: string, command: string) => `Die Aktualisierung von ${label} müssen Sie selbst in einem Terminal ausführen: ${command}`,
  partialCommand: (name: string) =>
    `Der Befehl wurde möglicherweise nur teilweise ausgeführt: Führen Sie baocut external-tools detect ${name} aus, um die aktuelle Version zu prüfen`,
};
