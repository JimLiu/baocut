import type { JobsResourceSchedulerMessages } from './resource-scheduler.ts';

const DIMENSIONS: Record<string, string> = {
  memory: '메모리',
  gpuMemory: 'GPU 메모리',
  cpuThreads: 'CPU 스레드',
  scratchDisk: '디스크 공간',
};

const names = (dimensions: string) =>
  dimensions
    .split(',')
    .map((d) => DIMENSIONS[d] ?? d)
    .join(', ');

export const ko: JobsResourceSchedulerMessages = {
  dimensionMemory: DIMENSIONS.memory!,
  dimensionGpuMemory: DIMENSIONS.gpuMemory!,
  dimensionCpuThreads: DIMENSIONS.cpuThreads!,
  dimensionScratchDisk: DIMENSIONS.scratchDisk!,
  exceedsCapacity: (p: { dimensions: string }) =>
    `필요한 ${names(p.dimensions)} 양이 이 컴퓨터가 제공할 수 있는 범위를 넘습니다`,
  queuedBehind: (p: { ahead: number }) => `대기 중: 같은 대기열에 앞선 작업이 ${p.ahead}개 있습니다`,
  queuedRunning: '대기 중: 같은 대기열의 작업이 실행 중입니다',
  waitingBehind: (p: { dimensions: string }) => `리소스 대기 중: 앞선 작업이 ${names(p.dimensions)} 확보를 기다리고 있습니다`,
  waitingShort: (p: { dimensions: string }) => `리소스 대기 중: ${names(p.dimensions)} 부족`,
};
