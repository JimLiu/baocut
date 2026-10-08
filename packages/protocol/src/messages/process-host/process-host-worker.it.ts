import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const it: ProcessHostWorkerMessages = {
  requestFailed: (p) => `${p.method} non riuscito: ${p.code}: ${p.message}`,
  exited: (p) => `${p.method} non è terminato: il processo figlio è uscito (code ${p.code}, signal ${p.signal})`,
  notRunning: (p) => `${p.method} non è stato inviato: il processo figlio non è in esecuzione`,
  timedOut: (p) => `${p.method} è scaduto (${p.ms} ms)`,
  spawnFailed: (p) => `Impossibile avviare ${p.command}: ${p.error}`,
  malformedError: "Il processo figlio ha restituito un errore non valido",
};
