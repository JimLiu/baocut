import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './job-reconcile.zh-Hans.ts';
import { zhHant } from './job-reconcile.zh-Hant.ts';
import { ja } from './job-reconcile.ja.ts';
import { ko } from './job-reconcile.ko.ts';
import { es } from './job-reconcile.es.ts';
import { fr } from './job-reconcile.fr.ts';
import { de } from './job-reconcile.de.ts';
import { nl } from './job-reconcile.nl.ts';
import { ptBR } from './job-reconcile.pt-BR.ts';
import { it } from './job-reconcile.it.ts';
import { ru } from './job-reconcile.ru.ts';
import { pl } from './job-reconcile.pl.ts';
import { tr } from './job-reconcile.tr.ts';
import { vi } from './job-reconcile.vi.ts';

/** `packages/jobs/src/job-reconcile.ts`：对账决定不被允许时。`allowed` 是决定名（`retry`、`discard`、`apply`）连成的一串。 */
const en = {
  onlyAllowed: (p: { allowed: string }) => `This task can only: ${p.allowed}`,
  noneAllowed: 'This task has no reconcile decision available right now',
};

export type JobsReconcileMessages = typeof en;

export const JobsReconcile = defineCatalog('jobsReconcile', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
