import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

const DIMENSIONS: Record<string, string> = {
  memory: '内存',
  gpuMemory: 'GPU 内存',
  cpuThreads: 'CPU 线程',
  scratchDisk: '磁盘空间',
};

const names = (dimensions: string) =>
  dimensions
    .split(',')
    .map((d) => DIMENSIONS[d] ?? d)
    .join('、');

export const zhHans: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `需要的${names(p.dimensions)}超过了这台机器能给的量`,
  queuedBehind: (p: { ahead: number }) => `排队中：同一队列前面还有 ${p.ahead} 个任务`,
  queuedRunning: '排队中：同一队列的任务正在执行',
  waitingBehind: (p: { dimensions: string }) => `等待资源：前面的任务在等${names(p.dimensions)}`,
  waitingShort: (p: { dimensions: string }) => `等待资源：${names(p.dimensions)}不够`,
};
