import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

const DIMENSIONS: Record<string, string> = {
  memory: 'メモリ',
  gpuMemory: 'GPU メモリ',
  cpuThreads: 'CPU スレッド',
  scratchDisk: 'ディスク容量',
};

const names = (dimensions: string) =>
  dimensions
    .split(',')
    .map((d) => DIMENSIONS[d] ?? d)
    .join('、');

export const ja: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) => `このコンピュータで確保できる量を超える ${names(p.dimensions)} が必要です`,
  queuedBehind: (p: { ahead: number }) => `待機中：同じキューの前に ${p.ahead} 件のタスクがあります`,
  queuedRunning: '待機中：同じキューのタスクが実行中です',
  waitingBehind: (p: { dimensions: string }) => `リソース待ち：先のタスクが ${names(p.dimensions)} を待っています`,
  waitingShort: (p: { dimensions: string }) => `リソース待ち：${names(p.dimensions)} が不足しています`,
};
