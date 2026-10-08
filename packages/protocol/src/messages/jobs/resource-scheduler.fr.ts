import { pluralForm } from '../../i18n.ts';
import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

const DIMENSIONS: Record<string, string> = { memory: 'mémoire', gpuMemory: 'mémoire GPU', cpuThreads: 'threads CPU', scratchDisk: 'espace disque' };
const names = (dimensions: string) => dimensions.split(',').map((d) => DIMENSIONS[d] ?? d).join(', ');

export const fr: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `Cela nécessite plus de ${names(p.dimensions)} que cet ordinateur peut fournir`,
  queuedBehind: (p: { ahead: number }) =>
    pluralForm('fr', p.ahead, { one: `En file d’attente : ${p.ahead} tâche avant dans la même file`, other: `En file d’attente : ${p.ahead} tâches avant dans la même file` }),
  queuedRunning: "En file d’attente : une tâche de la même file est en cours",
  waitingBehind: (p: { dimensions: string }) => `Attente de ressources : des tâches précédentes attendent ${names(p.dimensions)}`,
  waitingShort: (p: { dimensions: string }) => `Attente de ressources : quantité insuffisante de ${names(p.dimensions)}`,
};
