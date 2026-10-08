import type { ToolsRecordsMessages } from './tools-records.ts';

export const ja: ToolsRecordsMessages = {
  generating: '生成中',
  queued: '待機中',
  cancelled: 'キャンセル済み',
  failed: '失敗',
  unfinished: '未完了',
  unknown: '結果不明',
  interrupted: '完了する前に Runtime が停止または再起動しました',
  reconcile: 'この呼び出しの応答前に Runtime が再起動しました。結果は不明で、すでに課金されている可能性があります',
  noResult: '何も生成されませんでした',
};
