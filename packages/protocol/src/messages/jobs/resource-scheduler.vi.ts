import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

const DIMENSIONS: Record<string, string> = {
  memory: 'bộ nhớ',
  gpuMemory: 'bộ nhớ GPU',
  cpuThreads: 'luồng CPU',
  scratchDisk: 'dung lượng đĩa',
};

const names = (dimensions: string) =>
  dimensions
    .split(',')
    .map((d) => DIMENSIONS[d] ?? d)
    .join(', ');

export const vi: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `Cần nhiều ${names(p.dimensions)} hơn máy này có thể cung cấp`,
  queuedBehind: (p: { ahead: number }) => `Đang chờ: có ${p.ahead} tác vụ phía trước trong cùng hàng đợi`,
  queuedRunning: 'Đang chờ: tác vụ trong cùng hàng đợi đang chạy',
  waitingBehind: (p: { dimensions: string }) => `Đang chờ tài nguyên: tác vụ phía trước đang chờ ${names(p.dimensions)}`,
  waitingShort: (p: { dimensions: string }) => `Đang chờ tài nguyên: không đủ ${names(p.dimensions)}`,
};
