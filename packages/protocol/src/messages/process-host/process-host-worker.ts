import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './process-host-worker.zh-Hans.ts';
import { zhHant } from './process-host-worker.zh-Hant.ts';
import { ja } from './process-host-worker.ja.ts';
import { ko } from './process-host-worker.ko.ts';
import { es } from './process-host-worker.es.ts';
import { fr } from './process-host-worker.fr.ts';
import { de } from './process-host-worker.de.ts';
import { nl } from './process-host-worker.nl.ts';
import { ptBR } from './process-host-worker.pt-BR.ts';
import { it } from './process-host-worker.it.ts';
import { ru } from './process-host-worker.ru.ts';
import { pl } from './process-host-worker.pl.ts';
import { tr } from './process-host-worker.tr.ts';
import { vi } from './process-host-worker.vi.ts';

/** JSON 行子进程通道的错误（`packages/process-host`）。`method` 是请求的方法名。 */
const en = {
  requestFailed: (p: { method: string; code: string; message: string }) => `${p.method} failed: ${p.code}: ${p.message}`,
  exited: (p: { method: string; code: string; signal: string }) =>
    `${p.method} didn't finish: the child process exited (code ${p.code}, signal ${p.signal})`,
  notRunning: (p: { method: string }) => `${p.method} wasn't sent: the child process isn't running`,
  timedOut: (p: { method: string; ms: number }) => `${p.method} timed out (${p.ms} ms)`,
  spawnFailed: (p: { command: string; error: string }) => `Couldn't start ${p.command}: ${p.error}`,
  malformedError: 'The child process returned a malformed error',
};

export type ProcessHostWorkerMessages = typeof en;

export const ProcessHostWorker = defineCatalog('processHostWorker', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
