const DIMENSIONS: Record<string, string> = { memory: 'geheugen', gpuMemory: 'GPU-geheugen', cpuThreads: 'CPU-threads', scratchDisk: 'schijfruimte' };
const names = (dimensions: string) => dimensions.split(',').map((d) => DIMENSIONS[d] ?? d).join(', ');
import { pluralForm } from '../../i18n.ts';
import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

export const nl: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `Dit vereist meer ${names(p.dimensions)} dan deze computer kan bieden`,
  queuedBehind: (p: { ahead: number }) =>
    pluralForm('nl', p.ahead, { one: `In wachtrij: ${p.ahead} taak eerder in dezelfde wachtrij`, other: `In wachtrij: ${p.ahead} taken eerder in dezelfde wachtrij` }),
  queuedRunning: "In wachtrij: er loopt een taak in dezelfde wachtrij",
  waitingBehind: (p: { dimensions: string }) => `Wacht op middelen: eerdere taken wachten op ${names(p.dimensions)}`,
  waitingShort: (p: { dimensions: string }) => `Wacht op middelen: onvoldoende ${names(p.dimensions)}`,
};
