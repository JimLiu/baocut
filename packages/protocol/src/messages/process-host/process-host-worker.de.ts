import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const de: ProcessHostWorkerMessages = {
  requestFailed: (p: { method: string; code: string; message: string }) => `${p.method} fehlgeschlagen: ${p.code}: ${p.message}`,
  exited: (p: { method: string; code: string; signal: string }) =>
    `${p.method} nicht abgeschlossen: Unterprozess wurde beendet (Code ${p.code}, Signal ${p.signal})`,
  notRunning: (p: { method: string }) => `${p.method} nicht gesendet: Unterprozess läuft nicht`,
  timedOut: (p: { method: string; ms: number }) => `${p.method} hat das Zeitlimit überschritten (${p.ms} ms)`,
  spawnFailed: (p: { command: string; error: string }) => `Start fehlgeschlagen: ${p.command}: ${p.error}`,
  malformedError: "Der Unterprozess hat einen fehlerhaften Fehler zurückgegeben",
};
