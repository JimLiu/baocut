import type { AgentTurnMessages } from './agent-turn.ts';

export const ko: AgentTurnMessages = {
  waiting: '승인 대기 중',
  working: '진행 중',
  stopping: '중지하는 중',
  worked: (span: string) => `${span} 동안 작업함`,
  stoppedAfter: (span: string) => `중지됨 · ${span} 동안 작업함`,
  stopped: '중지됨',
  failed: (error: string | null) => `실패 · ${error ?? '알 수 없는 이유'}`,
  stepStatus: { declined: '거부됨', interrupted: '중단됨' },
  exitCode: (code: number) => `종료 코드 ${code}`,
  stepDeclined: '이 단계가 거부되었습니다',
  commandExited: (code: number) => `명령이 종료되었습니다(종료 코드 ${code})`,
  stepIncomplete: '이 단계가 완료되지 않았습니다',
  lineRange: (path: string, line: number, end: number) => `${path} · ${line}–${end}행`,
  lineCol: (path: string, line: number, col: number) => `${path} · ${line}행 ${col}열`,
  line: (path: string, line: number) => `${path} · ${line}행`,
};
