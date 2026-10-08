import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const de: RuntimeStorageCredentialsMessages = {
  denied: "Zugriff verweigert",
  unavailable: "Der Zugangsdaten-Speicher ist nicht verfügbar",
  unsupported: "Diese Plattform unterstützt den sicheren Systemspeicher nicht",
  internal: "Fehler beim Lesen oder Schreiben der Zugangsdaten",
  problem: (p: { reason: string; message: string }) => `${p.reason}: ${p.message}`,
  fileWriteFailed: (p: { code: string }) => `Zugangsdaten-Datei konnte nicht geschrieben werden (${p.code})`,
  fileUnreadable: (p) => `Zugangsdaten-Datei kann nicht gelesen werden und wurde unverändert gelassen (${p.code})`,
  helperBadResponse: "Das Zugangsdaten-Hilfsprogramm hat eine ungültige Antwort zurückgegeben",
  helperNotFound: "Das Zugangsdaten-Hilfsprogramm wurde nicht gefunden",
  helperTimedOut: (p: { seconds: number }) => `Das Zugangsdaten-Hilfsprogramm hat nicht geantwortet innerhalb von ${p.seconds} Sekunden`,
  helperMissing: "Das Zugangsdaten-Hilfsprogramm fehlt",
  helperStartFailed: (p: { code: string }) => `Das Zugangsdaten-Hilfsprogramm konnte nicht starten (${p.code})`,
  helperResponseTooLong: "Die Antwort des Zugangsdaten-Hilfsprogramms ist zu lang",
  helperExitedSilently: "Das Zugangsdaten-Hilfsprogramm wurde ohne Antwort beendet",
  helperReportedError: "Das Zugangsdaten-Hilfsprogramm hat einen Fehler gemeldet",
  redacted: "[entfernt]",
};
