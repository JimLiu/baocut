import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

const DIMENSIONS: Record<string, string> = {
  memory: 'bellek',
  gpuMemory: 'GPU belleği',
  cpuThreads: 'CPU iş parçacığı',
  scratchDisk: 'disk alanı',
};

const names = (dimensions: string) =>
  dimensions
    .split(',')
    .map((d) => DIMENSIONS[d] ?? d)
    .join(', ');

export const tr: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `Bu işlem makinenin sağlayabileceğinden daha fazla ${names(p.dimensions)} gerektiriyor`,
  queuedBehind: (p: { ahead: number }) => `Sırada: aynı kuyrukta önde ${p.ahead} görev var`,
  queuedRunning: 'Sırada: aynı kuyruktaki görev çalışıyor',
  waitingBehind: (p: { dimensions: string }) => `Kaynak bekleniyor: önceki görevler ${names(p.dimensions)} bekliyor`,
  waitingShort: (p: { dimensions: string }) => `Kaynak bekleniyor: yetersiz ${names(p.dimensions)}`,
};
