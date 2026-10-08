const DIMENSIONS: Record<string, string> = { memory: 'Arbeitsspeicher', gpuMemory: 'GPU-Speicher', cpuThreads: 'CPU-Threads', scratchDisk: 'Speicherplatz' };
const names = (dimensions: string) => dimensions.split(',').map((d) => DIMENSIONS[d] ?? d).join(', ');
import { pluralForm } from '../../i18n.ts';
import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

export const de: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `Dies benötigt mehr ${names(p.dimensions)}, als dieser Computer bereitstellen kann`,
  queuedBehind: (p: { ahead: number }) =>
    pluralForm('de', p.ahead, { one: `In Warteschlange: ${p.ahead} Aufgabe davor in derselben Warteschlange`, other: `In Warteschlange: ${p.ahead} Aufgaben davor in derselben Warteschlange` }),
  queuedRunning: "In Warteschlange: Eine Aufgabe in derselben Warteschlange läuft",
  waitingBehind: (p: { dimensions: string }) => `Wartet auf Ressourcen: frühere Aufgaben warten auf ${names(p.dimensions)}`,
  waitingShort: (p: { dimensions: string }) => `Wartet auf Ressourcen: nicht genug ${names(p.dimensions)}`,
};
