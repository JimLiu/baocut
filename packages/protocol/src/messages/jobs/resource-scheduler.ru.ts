import { pluralForm } from '../../i18n.ts';
import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

const DIMENSIONS: Record<string, string> = {
  memory: 'Память',
  gpuMemory: 'Память GPU',
  cpuThreads: 'Потоки CPU',
  scratchDisk: 'Место на диске',
};

const names = (dimensions: string) =>
  dimensions
    .split(',')
    .map((d) => DIMENSIONS[d] ?? d)
    .join(', ');

export const ru: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `Требуется больше ресурса «${names(p.dimensions)}», чем доступно на этом компьютере`,
  queuedBehind: (p: { ahead: number }) => pluralForm('ru', p.ahead, { one: `В очереди: впереди ${p.ahead} задача в той же очереди`, few: `В очереди: впереди ${p.ahead} задачи в той же очереди`, many: `В очереди: впереди ${p.ahead} задач в той же очереди`, other: `В очереди: впереди ${p.ahead} задачи в той же очереди` }),
  queuedRunning: "В очереди: выполняется задача из той же очереди",
  waitingBehind: (p: { dimensions: string }) => `Ожидание ресурсов: предыдущие задачи ждут ${names(p.dimensions)}`,
  waitingShort: (p: { dimensions: string }) => `Ожидание ресурсов: недостаточно ${names(p.dimensions)}`,
};
