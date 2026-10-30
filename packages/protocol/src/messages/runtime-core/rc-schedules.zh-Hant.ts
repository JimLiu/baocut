import type { RcSchedulesMessages } from './rc-schedules.ts';

export const zhHant: RcSchedulesMessages = {
  notFound: (p) => `找不到定時任務：${p.id}`,
  conversationNotFound: (p) => `找不到對話：${p.id}`,
  conversationArchived: '這個對話已封存。先從「已封存對話」裡還原，再為它建立定時任務。',
  noProject: '這個對話不在專案裡，無法每次在專案裡新開一個對話。',
  invalid: '定時任務的設定不正確：請檢查每次傳送的內容、頻率與最多執行次數。',
  notActive: '只有啟用中的定時任務能立即執行。',
  resumeArchived: '目標對話已封存。請從「已封存對話」裡還原它，或編輯定時任務改成每次新開一個對話。',
  resumeDeleted: '目標對話已刪除。請編輯定時任務改成每次新開一個對話。',
  resumeProjectRemoved: '這個專案已從 BaoCut 移除，無法在裡面新開對話。',
  resumeCompleted: '已達最多執行次數。請先調高次數，再繼續。',
  runStopped: '未執行完就停止了',
};
