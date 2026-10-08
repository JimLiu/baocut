import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './resource-scheduler.zh-Hans.ts';
import { zhHant } from './resource-scheduler.zh-Hant.ts';
import { ja } from './resource-scheduler.ja.ts';
import { ko } from './resource-scheduler.ko.ts';
import { es } from './resource-scheduler.es.ts';
import { fr } from './resource-scheduler.fr.ts';
import { de } from './resource-scheduler.de.ts';
import { nl } from './resource-scheduler.nl.ts';
import { ptBR } from './resource-scheduler.pt-BR.ts';
import { it } from './resource-scheduler.it.ts';
import { ru } from './resource-scheduler.ru.ts';
import { pl } from './resource-scheduler.pl.ts';
import { tr } from './resource-scheduler.tr.ts';
import { vi } from './resource-scheduler.vi.ts';

/** 资源维度的名字（键是 `ResourceDimension`）。 */
const DIMENSIONS: Record<string, string> = {
  memory: 'memory',
  gpuMemory: 'GPU memory',
  cpuThreads: 'CPU threads',
  scratchDisk: 'disk space',
};

/** `dimensions` 是逗号分隔的维度键（`memory,gpuMemory`）：在读者的语言里展开成名字。 */
const names = (dimensions: string) =>
  dimensions
    .split(',')
    .map((d) => DIMENSIONS[d] ?? d)
    .join(', ');

/** `packages/jobs/src/resource-scheduler.ts`：排队时在等什么（`JobRecord.wait.detail`）与超出容量的拒绝。 */
const en = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `This needs more ${names(p.dimensions)} than this machine can provide`,
  queuedBehind: (p: { ahead: number }) =>
    p.ahead === 1 ? 'Queued: 1 task ahead in the same queue' : `Queued: ${p.ahead} tasks ahead in the same queue`,
  queuedRunning: 'Queued: a task in the same queue is running',
  waitingBehind: (p: { dimensions: string }) => `Waiting for resources: earlier tasks are waiting for ${names(p.dimensions)}`,
  waitingShort: (p: { dimensions: string }) => `Waiting for resources: not enough ${names(p.dimensions)}`,
};

export type JobsResourceSchedulerMessages = typeof en;

export const JobsResourceScheduler = defineCatalog('jobsResourceScheduler', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
