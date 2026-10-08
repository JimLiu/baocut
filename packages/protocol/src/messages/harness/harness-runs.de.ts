import type { HarnessRunsMessages } from './harness-runs.ts';

export const de: HarnessRunsMessages = {
  retrying: (p: { message: string }) => `${p.message} (erneuter Versuch)`,
  modeChanged: (p: { to: string; from: string }) => `Zugriffsmodus geändert zu „${p.to}“ (vorher „${p.from}“). Gilt für spätere Aktionen.`,
  jobsCancelled: (p: { count: number }) =>
    `Abbruch der nicht abgeschlossenen Hintergrundaufgaben dieser Sitzung angefordert (${p.count}). Fertige Ergebnisse bleiben erhalten.`,
  jobsCancelledGenerated: (p: { count: number }) =>
    `Abbruch der nicht abgeschlossenen Hintergrundaufgaben dieser Sitzung angefordert (${p.count}, Erzeugung oder Transkription). Fertige Ergebnisse bleiben erhalten.`,
  goalChangedStopped: "Ziel geändert: Die alte Aufgabe wurde gestoppt. Eine neue Aufgabe für das neue Ziel wird gestartet.",
  goalChangedKept:
    "Ziel geändert: Die Runde der alten Aufgabe wurde gestoppt. Bereits eingereichte Hintergrundaufgaben laufen normal zu Ende und ihre Ergebnisse bleiben als Kandidaten erhalten. Eine neue Aufgabe für das neue Ziel wird gestartet.",
  stopReplyUnconfirmed: (p: { agent: string }) => `Stopp der Antwort angefordert; konnte aber nicht bestätigen, dass ${p.agent} gestoppt wurde.`,
  stopUnconfirmed: (p: { agent: string }) => `Stopp angefordert; konnte aber nicht bestätigen, dass ${p.agent} gestoppt wurde.`,
  stopTimedOut: (p: { agent: string }) =>
    `${p.agent} hat den Stopp nicht innerhalb von 10 Sekunden bestätigt; der Prozess wurde daher beendet. Schritte ohne bestätigten Abbruch wurden möglicherweise bereits wirksam.`,
  agentRemovedNotice: (p: { agent: string }) =>
    `Agent ${p.agent} wurde entfernt; diese Aufgabe wurde daher nicht abgeschlossen. Bereits vorgenommene Änderungen werden nicht automatisch rückgängig gemacht.`,
  agentRemoved: (p: { agent: string }) => `Agent ${p.agent} wurde entfernt`,
  runtimeStoppedNotice: "Die Aufgabe lief noch, als die Runtime gestoppt wurde; sie wurde daher unterbrochen.",
  runtimeExitedNotice: "Die Runtime wurde während der Aufgabe beendet; diese Aufgabe wurde daher nicht abgeschlossen. Bereits vorgenommene Änderungen werden nicht automatisch rückgängig gemacht.",
  runtimeExited: "Die Runtime wurde während der Aufgabe beendet",
  turnFailed: "Die Runde ist fehlgeschlagen",
  processExited: (p: { agent: string; error: string }) => `${p.agent}-Prozess unerwartet beendet: ${p.error}`,
  noErrorMessage: "keine Fehlermeldung",

  fileChangeSummary: "Dateien bearbeiten",
};
