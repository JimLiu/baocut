import type { AgentTurnMessages } from './agent-turn.ts';

export const zhHant: AgentTurnMessages = {
  waiting: '等待你核准',
  working: '處理中',
  stopping: '正在停止',
  worked: (span: string) => `已工作 ${span}`,
  stoppedAfter: (span: string) => `已停止 · 工作了 ${span}`,
  stopped: '已停止',
  failed: (error: string | null) => `失敗 · ${error ?? '原因不明'}`,
  stepStatus: { declined: '已拒絕', interrupted: '已中斷' },
  exitCode: (code: number) => `結束代碼 ${code}`,
  stepDeclined: '這一步被拒絕了',
  commandExited: (code: number) => `指令以結束代碼 ${code} 結束`,
  stepIncomplete: '這一步沒有完成',
  lineRange: (path: string, line: number, end: number) => `${path} · 第 ${line}–${end} 行`,
  lineCol: (path: string, line: number, col: number) => `${path} · 第 ${line} 行第 ${col} 欄`,
  line: (path: string, line: number) => `${path} · 第 ${line} 行`,
};
