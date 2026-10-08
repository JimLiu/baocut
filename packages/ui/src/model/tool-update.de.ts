import type { ToolUpdateMessages } from './tool-update.ts';

export const de: ToolUpdateMessages = {
  standalone: "Offizielle eigenständige Binärdatei",
  updateInTerminal: "Im Terminal aktualisieren",
  unknownInstall: "Die Installationsart von yt-dlp ist unbekannt. Den zur Installation passenden Befehl ausführen und anschließend auf „Erneut prüfen“ klicken.",
  cannotRun: "BaoCut kann diesen Befehl nicht für Sie ausführen.",
  thenRecheck: "Anschließend auf „Erneut prüfen“ klicken.",
  runThenRecheck: "Diesen Befehl im Terminal ausführen und anschließend auf „Erneut prüfen“ klicken.",
  updateWith: (method: string) => `Aktualisieren mit ${method}`,
  stoppedTitle: "Aktualisierung gestoppt",
  stoppedBody: "Der Befehl wurde möglicherweise nur teilweise ausgeführt. Die Ausgabe unten prüfen und anschließend auf „Erneut prüfen“ klicken, um die aktuelle yt-dlp-Version zu bestätigen.",
  failedTitle: (exitCode: string | null) => (exitCode === null ? "Aktualisierung nicht abgeschlossen" : `Aktualisierung nicht abgeschlossen (Exit-Code ${exitCode})`),
  failedBody: (error: string | null) =>
    `${error ? `${error.replace(/[。.]$/, "")}. ` : ""}Ihre vorhandene yt-dlp-Installation bleibt unberührt. Die Ausgabe steht unten; Sie können den Befehl auch kopieren, im Terminal ausführen und anschließend auf „Erneut prüfen“ klicken.`,
  updatedTo: (version: string) => `Aktualisiert auf ${version}`,
  upToDate: (version: string | null) => (version ? `Bereits aktuell (${version})` : "Bereits aktuell"),
  logTruncated: "… (frühere Ausgabe ausgelassen; die vollständige Ausgabe steht im Aufgabenprotokoll)\\n",
  logStopped: "(Gestoppt)",
  logExitCode: (exitCode: string) => `(Exit-Code ${exitCode})`,
};
