import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const nl: ProcessHostWorkerMessages = {
  requestFailed: (p: { method: string; code: string; message: string }) => `${p.method} mislukt: ${p.code}: ${p.message}`,
  exited: (p: { method: string; code: string; signal: string }) =>
    `${p.method} niet voltooid: het onderliggende proces is afgesloten (code ${p.code}, signaal ${p.signal})`,
  notRunning: (p: { method: string }) => `${p.method} niet verzonden: het onderliggende proces loopt niet`,
  timedOut: (p: { method: string; ms: number }) => `${p.method} heeft de tijdslimiet overschreden (${p.ms} ms)`,
  spawnFailed: (p: { command: string; error: string }) => `Kan niet starten: ${p.command}: ${p.error}`,
  malformedError: "Het onderliggende proces heeft een ongeldig foutbericht geretourneerd",
};
