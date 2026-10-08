import type { ToolsRecordsMessages } from './tools-records.ts';

export const zhHant: ToolsRecordsMessages = {
  generating: '生成中',
  queued: '排隊中',
  cancelled: '已取消',
  failed: '失敗',
  unfinished: '未完成',
  unknown: '結果不明',
  interrupted: 'Runtime 在這一項完成前停止或重新啟動',
  reconcile: '這次呼叫回應前 Runtime 已重新啟動。結果不明，可能已經計費',
  noResult: '沒有生成任何內容',
};
