import type { ToolsRecordsMessages } from './tools-records.ts';

export const zhHans: ToolsRecordsMessages = {
  generating: '生成中',
  queued: '排队中',
  cancelled: '已取消',
  failed: '失败',
  unfinished: '没有做完',
  unknown: '结果不明',
  interrupted: 'Runtime 停止或重启，这一条没有做完',
  reconcile: 'Runtime 重启时这次调用还没有回音，结果不明，可能已经计费',
  noResult: '没有生成出来',
};
