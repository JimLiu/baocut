import type { DriversCommonMessages } from './drivers-common.ts';

export const de: DriversCommonMessages = {
  executableMissing: (p: { command: string; path: string }) => `Der angegebene Befehl ${p.command} (${p.path}) ist nicht vorhanden oder kann nicht ausgeführt werden.`,
  commandMissing: (p: { command: string; hint: string }) => `Befehl nicht gefunden: ${p.command}. ${p.hint} oder den Speicherort in den Einstellungen festlegen.`,
  commandNotFound: (p: { command: string }) => `Befehl nicht gefunden: ${p.command}-Befehl`,
  installItFirst: "Zuerst installieren",
  versionFailed: (p: { command: string }) => `${p.command} --version wurde nicht normal beendet.`,
  outdated: (p: { name: string; version: string; min: string }) => `${p.name} ${p.version} ist zu alt. BaoCut benötigt ${p.min} oder neuer.`,
  startFailed: (p: { name: string; error: string }) => `${p.name} konnte nicht starten: ${p.error}`,
  openSessionFailed: (p: { name: string; error: string }) => `${p.name} konnte keine Sitzung öffnen: ${p.error}`,
  confinedUnsupported: (p: { name: string }) => `${p.name} unterstützt keine eingeschränkten Einzelaufrufe`,

  resumeFailed: (p: { name: string; error: string }) =>
    `Wiederaufnahme fehlgeschlagen für die native Sitzung von ${p.name}${p.error ? ` (${p.error})` : ""}. Eine neue Sitzung wurde gestartet; der Agent kann die vorherige Unterhaltung nicht sehen.`,
  sessionClosed: (p: { name: string }) => `Die Sitzung von ${p.name} ist geschlossen`,
  sessionNotReady: (p: { name: string }) => `Die Sitzung von ${p.name} ist noch nicht bereit`,
  turnInProgress: "Die vorherige Runde ist noch nicht abgeschlossen",
  modelSwitchFailed: (p: { name: string; model: string; error: string }) => `${p.name} konnte nicht wechseln zum Modell ${p.model}: ${p.error}`,
  timedOut: (p: { label: string; seconds: number }) => `${p.label} hat das Zeitlimit überschritten (${p.seconds} s)`,
  unknownError: "Unbekannter Fehler",
  unknownReason: "unbekannter Grund",

  imagePlaceholder: "[Bild]",

  officialScript: "Offizielles Skript",
};
