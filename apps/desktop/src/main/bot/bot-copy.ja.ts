import type { BotMessages } from './bot-copy.ts';

export const ja: BotMessages = {
  trayOpen: 'BaoCut を開く',
  trayWorking: (count: number) => `作業中のタスク（${count}）`,
  trayNoWorking: '作業中のタスクはありません',
  trayPause: 'すべての自動実行を一時停止',
  trayResume: '自動実行を再開',
  trayQuit: 'バックグラウンドサービスを終了',
  trayTooltip: 'BaoCut バックグラウンドサービス',
  trayTooltipNeedsYou: (count: number) => `BaoCut：対応待ちが ${count} 件あります`,
  trayTooltipPaused: 'BaoCut：自動実行は一時停止中',
  notifyMerged: (count: number, channel: string) => `${channel} で ${count} 件があなたを待っています`,
  notifySummary: (count: number) => `夜のあいだに ${count} 件があなたを待っていました`,
  notifyReason: {
    'needs-review': 'レビュー待ち',
    'needs-input': '入力が必要です',
    reminder: 'リマインダー',
    'unattended-approval': '承認待ち',
    stalled: '停止しました。確認してください',
  },
  residentQuitTitle: 'Bot はバックグラウンドで作業を続けます',
  residentQuitDetailMac:
    'BaoCut を閉じても、メニューバーから定期タスクと作業中のタスクを実行し続けます。すべて止めるには「完全に終了」を選んでください。',
  residentQuitDetailOther:
    'BaoCut を閉じても、通知領域から定期タスクと作業中のタスクを実行し続けます。すべて止めるには「完全に終了」を選んでください。',
  residentKeep: 'バックグラウンドで続ける',
  residentQuit: '完全に終了',
  quitServiceTitle: 'バックグラウンドサービスを終了しますか？',
  quitServiceDetail: 'BaoCut を再び開くまで Bot は動きません。その間に予定時刻になった定期タスクは「見逃し」として記録されます。',
  quitServiceThreads: (count: number) => `作業中の ${count} 件のタスクが停止します：`,
  quitServiceSchedules: (count: number) => `次の ${count} 件の定期タスクは実行されません：`,
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'バックグラウンドサービスを終了',
  more: (count: number) => `ほか ${count} 件`,
  cancel: 'キャンセル',
};
