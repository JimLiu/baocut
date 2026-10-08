import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';
import { pluralForm } from '../../i18n.ts';

const DIMENSIONS: Record<string, string> = { memory: 'memória', gpuMemory: 'memória da GPU', cpuThreads: 'threads de CPU', scratchDisk: 'espaço em disco' };
const names = (dimensions: string) => dimensions.split(',').map((d) => DIMENSIONS[d] ?? d).join(', ');

export const ptBR: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!, dimensionGpuMemory: DIMENSIONS.gpuMemory!, dimensionCpuThreads: DIMENSIONS.cpuThreads!, dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p) => `Precisa de mais ${names(p.dimensions)} do que este computador pode fornecer`,
  queuedBehind: (p) => pluralForm('pt-BR', p.ahead, { one: `Na fila: ${p.ahead} tarefa à frente na mesma fila`, other: `Na fila: ${p.ahead} tarefas à frente na mesma fila` }),
  queuedRunning: 'Na fila: uma tarefa da mesma fila está em execução',
  waitingBehind: (p) => `Aguardando recursos: tarefas anteriores estão esperando por ${names(p.dimensions)}`,
  waitingShort: (p) => `Aguardando recursos: ${names(p.dimensions)} insuficiente`,
};
