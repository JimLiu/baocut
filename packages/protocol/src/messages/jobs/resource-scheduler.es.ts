import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';
import { pluralForm } from '../../i18n.ts';
const DIMENSIONS: Record<string, string> = { memory: 'memoria', gpuMemory: 'memoria de GPU', cpuThreads: 'hilos de CPU', scratchDisk: 'espacio en disco' };
const names = (dimensions: string) => dimensions.split(',').map((d) => DIMENSIONS[d] ?? d).join(', ');
export const es: JobsResourceSchedulerMessages = {
 dimensionMemory: 'Memoria', dimensionGpuMemory: 'Memoria de GPU', dimensionCpuThreads: 'Hilos de CPU', dimensionScratchDisk: 'Espacio en disco',
 exceedsCapacity: (p) => `Se necesita más ${names(p.dimensions)} de lo que puede proporcionar este ordenador`,
 queuedBehind: (p) => `En cola: ${p.ahead} ${pluralForm('es', p.ahead, { one: 'tarea delante', other: 'tareas delante' })} en la misma cola`,
 queuedRunning: 'En cola: hay una tarea de la misma cola en curso', waitingBehind: (p) => `Esperando recursos: las tareas anteriores esperan ${names(p.dimensions)}`,
 waitingShort: (p) => `Esperando recursos: no hay suficiente ${names(p.dimensions)}`,
};
