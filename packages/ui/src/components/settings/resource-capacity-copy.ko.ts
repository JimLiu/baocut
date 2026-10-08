import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const ko: ResourceCapacityMessages = {
  title: '리소스 스케줄링',
  resetAll: '모두 자동으로 재설정',
  lead: '전사, 로컬 모델, 내보내기 같은 무거운 작업은 이 컴퓨터의 용량에 맞춰 대기합니다. 여유가 있으면 시작하고, 그렇지 않으면 앞선 작업이 끝날 때까지 기다립니다. 용량은 자동으로 감지됩니다. 이 컴퓨터에서 다른 큰 프로그램도 실행하거나 감지가 정확하지 않으면 한도를 직접 설정할 수 있으며, 비워 두면 자동입니다.',
  disconnected: 'Runtime에 연결되지 않음',
  loadFailed: '리소스 상태를 읽지 못했습니다',
  loading: '리소스 상태 읽는 중…',
  limitOf: (label: string, unit: string) => `${label} 한도(${unit})`,
  unit: { memoryGB: 'GB', gpuMemoryGB: 'GB', cpuThreads: '스레드' },
  notSettable: '직접 설정할 수 없음',
  inUseAndQueued: '사용 중 및 대기 중',
  inUse: (demand: string) => `사용 중 · ${demand}`,
  queued: (detail: string | null, demand: string) => `대기 중 · ${detail ?? '시작 대기 중'} · ${demand} 필요`,
  idle: '로컬 리소스를 사용하는 작업이 없습니다',
  saveFailed: (message: string) => `저장하지 못했습니다: ${message}`,
};
