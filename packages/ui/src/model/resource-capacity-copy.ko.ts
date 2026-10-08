import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const ko: ResourceCapacityMessages = {
  sources: {
    system: '시스템에서 감지',
    setting: '직접 설정',
    'unified-estimate': '통합 메모리로 추정',
    unknown: '알 수 없음',
    statfs: '임시 파일이 있는 디스크의 여유 공간',
  },
  dimensions: { memory: '메모리', gpuMemory: 'GPU 메모리', cpuThreads: 'CPU 스레드', scratchDisk: '임시 디스크 공간' },
  unknown: '알 수 없음',
  threads: (n) => `스레드 ${n}개`,
  unifiedMemory: '메모리와 공유하며, GPU 사용량도 메모리 사용량에 포함됩니다',
  inUse: (amount) => `${amount} 사용 중`,
  backgroundAvailable: (amount) => `백그라운드 작업에 ${amount} 사용 가능`,
  demandPart: (dimension, amount) => `${dimension} ${amount}`,
  joinDemand: (parts) => parts.join(', '),
  noDemand: '로컬 리소스를 쓰지 않음',
  auto: '자동',
  autoWith: (value) => `자동(${value})`,
};
