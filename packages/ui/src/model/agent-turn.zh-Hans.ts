import type { AgentTurnMessages } from './agent-turn.ts';

export const zhHans: AgentTurnMessages = {
  waiting: '等你允许',
  working: '正在工作',
  stopping: '正在停止',
  worked: (span: string) => `已工作 ${span}`,
  stoppedAfter: (span: string) => `已停止 · 工作了 ${span}`,
  stopped: '已停止',
  failed: (error: string | null) => `失败 · ${error ?? '原因未知'}`,
  stepStatus: { declined: '已拒绝', interrupted: '已中断' },
  exitCode: (code: number) => `退出码 ${code}`,
  stepDeclined: '这一步被拒绝了',
  commandExited: (code: number) => `命令以退出码 ${code} 结束`,
  stepIncomplete: '这一步没有完成',
  lineRange: (path: string, line: number, end: number) => `${path} · 第 ${line}–${end} 行`,
  lineCol: (path: string, line: number, col: number) => `${path} · 第 ${line} 行第 ${col} 列`,
  line: (path: string, line: number) => `${path} · 第 ${line} 行`,
};
