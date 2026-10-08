import { pluralForm } from '../../i18n.ts';
import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

const DIMENSIONS: Record<string, string> = {
  memory: 'Pamięć',
  gpuMemory: 'Pamięć GPU',
  cpuThreads: 'Wątki CPU',
  scratchDisk: 'Miejsce na dysku',
};

const names = (dimensions: string) =>
  dimensions
    .split(',')
    .map((d) => DIMENSIONS[d] ?? d)
    .join(', ');

export const pl: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `Wymaga więcej zasobu „${names(p.dimensions)}”, niż ten komputer może zapewnić`,
  queuedBehind: (p: { ahead: number }) => pluralForm('pl', p.ahead, { one: `W kolejce: ${p.ahead} zadanie przed nim w tej samej kolejce`, few: `W kolejce: ${p.ahead} zadania przed nim w tej samej kolejce`, many: `W kolejce: ${p.ahead} zadań przed nim w tej samej kolejce`, other: `W kolejce: ${p.ahead} zadania przed nim w tej samej kolejce` }),
  queuedRunning: "W kolejce: trwa zadanie z tej samej kolejki",
  waitingBehind: (p: { dimensions: string }) => `Oczekiwanie na zasoby: wcześniejsze zadania czekają na ${names(p.dimensions)}`,
  waitingShort: (p: { dimensions: string }) => `Oczekiwanie na zasoby: za mało ${names(p.dimensions)}`,
};
