import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const pl: ProcessHostWorkerMessages = {
  requestFailed: (p) => `${p.method} – niepowodzenie: ${p.code}: ${p.message}`,
  exited: (p) => `${p.method} nie zostało ukończone: proces potomny zakończył działanie (kod ${p.code}, sygnał ${p.signal})`,
  notRunning: (p) => `${p.method} nie zostało wysłane: proces potomny nie działa`,
  timedOut: (p) => `${p.method} – upłynął limit czasu (${p.ms} ms)`,
  spawnFailed: (p) => `Nie udało się uruchomić ${p.command}: ${p.error}`,
  malformedError: "Proces potomny zwrócił błąd o nieprawidłowym formacie",
};
