import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

const DIMENSIONS: Record<string, string> = {
  memory: '記憶體',
  gpuMemory: 'GPU 記憶體',
  cpuThreads: 'CPU 執行緒',
  scratchDisk: '磁碟空間',
};

const names = (dimensions: string) =>
  dimensions
    .split(',')
    .map((d) => DIMENSIONS[d] ?? d)
    .join('、');

export const zhHant: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `需要的${names(p.dimensions)}超過這台機器所能提供的量`,
  queuedBehind: (p: { ahead: number }) => `排隊中：同一佇列前面還有 ${p.ahead} 個任務`,
  queuedRunning: '排隊中：同一佇列中有任務正在執行',
  waitingBehind: (p: { dimensions: string }) => `等待資源：前面的任務正在等待${names(p.dimensions)}`,
  waitingShort: (p: { dimensions: string }) => `等待資源：${names(p.dimensions)}不足`,
};
