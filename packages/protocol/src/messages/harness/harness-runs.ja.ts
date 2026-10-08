import type { HarnessRunsMessages } from './harness-runs.ts';

export const ja: HarnessRunsMessages = {
  retrying: (p) => `${p.message}（再試行中）`,
  modeChanged: (p) => `アクセスモードを「${p.to}」に変更しました（変更前は「${p.from}」）。以降の操作に適用されます。`,
  jobsCancelled: (p) =>
    `このセッションの未完了のバックグラウンドタスク（${p.count} 件）のキャンセルを要求しました。完了済みの結果は残ります。`,
  jobsCancelledGenerated: (p) =>
    `このセッションの未完了のバックグラウンドタスク（${p.count} 件、生成または文字起こし）のキャンセルを要求しました。完了済みの結果は残ります。`,
  goalChangedStopped: '目標が変更されました：以前のタスクを停止しました。新しい目標で新しいタスクを開始します。',
  goalChangedKept:
    '目標が変更されました：以前のタスクのターンを停止しました。送信済みのバックグラウンドタスクは通常どおり完了し、その生成物は候補として残ります。新しい目標で新しいタスクを開始します。',
  stopReplyUnconfirmed: (p) => `応答の停止を要求しましたが、${p.agent} が停止したことを確認できませんでした。`,
  stopUnconfirmed: (p) => `停止を要求しましたが、${p.agent} が停止したことを確認できませんでした。`,
  stopTimedOut: (p) =>
    `${p.agent} が 10 秒以内に停止を確認しなかったため、プロセスを終了しました。キャンセルが確認されていない手順は、すでに反映されている可能性があります。`,
  agentRemovedNotice: (p) =>
    `Agent ${p.agent} が削除されたため、このタスクは完了しませんでした。すでに行われた変更は自動では取り消されません。`,
  agentRemoved: (p) => `Agent ${p.agent} が削除されました`,
  runtimeStoppedNotice: 'Runtime が停止したときにタスクがまだ実行中だったため、中断されました。',
  runtimeExitedNotice: 'タスクの実行中に Runtime が終了したため、このタスクは完了しませんでした。すでに行われた変更は自動では取り消されません。',
  runtimeExited: 'タスクの実行中に Runtime が終了しました',
  turnFailed: 'ターンが失敗しました',
  processExited: (p) => `${p.agent} のプロセスが予期せず終了しました：${p.error}`,
  noErrorMessage: 'エラーメッセージなし',
  fileChangeSummary: 'ファイルを編集',
};
