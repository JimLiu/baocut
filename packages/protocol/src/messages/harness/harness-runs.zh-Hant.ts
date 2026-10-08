import type { HarnessRunsMessages } from './harness-runs.ts';

export const zhHant: HarnessRunsMessages = {
  retrying: (p) => `${p.message}（正在重試）`,
  modeChanged: (p) => `存取模式已切換為「${p.to}」（原為「${p.from}」），套用於之後的動作。`,
  jobsCancelled: (p) => `已請求取消這個對話中尚未完成的背景任務（${p.count} 個）。已完成的結果會保留。`,
  jobsCancelledGenerated: (p) => `已請求取消這個對話中尚未完成的背景任務（${p.count} 個，生成或轉錄）。已完成的結果會保留。`,
  goalChangedStopped: '目標已變更：舊任務已停止，正在依新目標建立新任務。',
  goalChangedKept: '目標已變更：舊任務的這一輪已停止。已提交的背景任務會照常完成，產出保留為候選。正在依新目標建立新任務。',
  stopReplyUnconfirmed: (p) => `已請求停止回覆，但無法確認 ${p.agent} 是否已停止。`,
  stopUnconfirmed: (p) => `已請求停止，但無法確認 ${p.agent} 是否已停止。`,
  stopTimedOut: (p) => `${p.agent} 沒有在 10 秒內確認停止，已結束它的處理程序。未確認取消的步驟可能已經生效。`,
  agentRemovedNotice: (p) => `Agent ${p.agent} 已被移除，這個任務沒有完成。已做的修改不會自動還原。`,
  agentRemoved: (p) => `Agent ${p.agent} 已被移除`,
  runtimeStoppedNotice: 'Runtime 停止時任務仍在執行，因此已中斷。',
  runtimeExitedNotice: 'Runtime 在任務執行期間結束，這個任務沒有完成。已做的修改不會自動還原。',
  runtimeExited: 'Runtime 在任務執行期間結束',
  turnFailed: '回合失敗',
  processExited: (p) => `${p.agent} 處理程序意外結束：${p.error}`,
  noErrorMessage: '沒有錯誤訊息',
  fileChangeSummary: '修改檔案',
};
