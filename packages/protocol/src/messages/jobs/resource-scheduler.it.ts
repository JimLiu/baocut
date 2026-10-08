import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';
import { pluralForm } from '../../i18n.ts';

const DIMENSIONS: Record<string, string> = { memory: 'memoria', gpuMemory: 'memoria GPU', cpuThreads: 'thread CPU', scratchDisk: 'spazio su disco' };
const names = (dimensions: string) => dimensions.split(',').map((d) => DIMENSIONS[d] ?? d).join(', ');

export const it: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!, dimensionGpuMemory: DIMENSIONS.gpuMemory!, dimensionCpuThreads: DIMENSIONS.cpuThreads!, dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p) => `Richiede più ${names(p.dimensions)} di quanto questo computer possa fornire`,
  queuedBehind: (p) => pluralForm('it', p.ahead, { one: `In coda: ${p.ahead} attività precedente nella stessa coda`, other: `In coda: ${p.ahead} attività precedenti nella stessa coda` }),
  queuedRunning: 'In coda: un’attività della stessa coda è in esecuzione',
  waitingBehind: (p) => `In attesa di risorse: le attività precedenti stanno aspettando ${names(p.dimensions)}`,
  waitingShort: (p) => `In attesa di risorse: disponibilità insufficiente di ${names(p.dimensions)}`,
};
