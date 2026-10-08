import type { AgentTurnMessages } from './agent-turn.ts';

export const ja: AgentTurnMessages = {
  waiting: '承認待ち',
  working: '処理中',
  stopping: '停止中',
  worked: (span: string) => `作業時間 ${span}`,
  stoppedAfter: (span: string) => `停止 · 作業時間 ${span}`,
  stopped: '停止',
  failed: (error: string | null) => `失敗 · ${error ?? '原因不明'}`,
  stepStatus: { declined: '拒否済み', interrupted: '中断' },
  exitCode: (code: number) => `終了コード ${code}`,
  stepDeclined: 'このステップは拒否されました',
  commandExited: (code: number) => `コマンドは終了コード ${code} で終了しました`,
  stepIncomplete: 'このステップは完了しませんでした',
  lineRange: (path: string, line: number, end: number) => `${path} · ${line}–${end} 行目`,
  lineCol: (path: string, line: number, col: number) => `${path} · ${line} 行目、${col} 列目`,
  line: (path: string, line: number) => `${path} · ${line} 行目`,
};
