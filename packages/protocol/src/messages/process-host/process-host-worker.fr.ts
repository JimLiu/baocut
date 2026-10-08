import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const fr: ProcessHostWorkerMessages = {
  requestFailed: (p) => `${p.method} a échoué : ${p.code} : ${p.message}`, exited: (p) => `${p.method} n’a pas terminé : le processus enfant s’est arrêté (code ${p.code}, signal ${p.signal})`,
  notRunning: (p) => `${p.method} n’a pas été envoyé : le processus enfant ne fonctionne pas`, timedOut: (p) => `${p.method} a expiré (${p.ms} ms)`,
  spawnFailed: (p) => `Impossible de démarrer ${p.command} : ${p.error}`, malformedError: 'Le processus enfant a renvoyé une erreur mal formée',
};
