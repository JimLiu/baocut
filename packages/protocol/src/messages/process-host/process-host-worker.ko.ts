import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const ko: ProcessHostWorkerMessages = {
  requestFailed: (p) => `${p.method} 실패: ${p.code}: ${p.message}`,
  exited: (p) => `${p.method} 미완료: 자식 프로세스가 종료되었습니다(code ${p.code}, signal ${p.signal})`,
  notRunning: (p) => `${p.method} 전송 안 됨: 자식 프로세스가 실행 중이 아닙니다`,
  timedOut: (p) => `${p.method} 시간 초과(${p.ms} ms)`,
  spawnFailed: (p) => `${p.command} 명령을 시작하지 못했습니다: ${p.error}`,
  malformedError: '자식 프로세스가 형식이 잘못된 오류를 반환했습니다',
};
