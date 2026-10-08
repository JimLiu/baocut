import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const ptBR: ProcessHostWorkerMessages = {
  requestFailed: (p) => `${p.method} falhou: ${p.code}: ${p.message}`,
  exited: (p) => `${p.method} não terminou: o processo filho saiu (code ${p.code}, signal ${p.signal})`,
  notRunning: (p) => `${p.method} não foi enviado: o processo filho não está em execução`,
  timedOut: (p) => `${p.method} expirou (${p.ms} ms)`,
  spawnFailed: (p) => `Não foi possível iniciar ${p.command}: ${p.error}`,
  malformedError: "O processo filho retornou um erro malformado",
};
