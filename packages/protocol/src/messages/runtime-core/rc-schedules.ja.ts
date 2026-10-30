import type { RcSchedulesMessages } from './rc-schedules.ts';

export const ja: RcSchedulesMessages = {
  notFound: (p) => `定期タスクが見つかりません：${p.id}`,
  conversationNotFound: (p) => `セッションが見つかりません：${p.id}`,
  conversationArchived: 'このセッションはアーカイブ済みです。「アーカイブ済みのセッション」から復元してから定期タスクを作成してください。',
  noProject: 'このセッションはプロジェクトに属していないため、毎回プロジェクトで新しいセッションを開くことはできません。',
  invalid: '定期タスクの設定を確認してください。送信する内容、頻度、実行回数の上限が正しく入力されている必要があります。',
  notActive: '今すぐ実行できるのは有効な定期タスクだけです。',
  resumeArchived:
    '対象のセッションはアーカイブ済みです。「アーカイブ済みのセッション」から復元するか、毎回新しいセッションを開くよう定期タスクを編集してください。',
  resumeDeleted: '対象のセッションは削除されました。毎回新しいセッションを開くよう定期タスクを編集してください。',
  resumeProjectRemoved: 'このプロジェクトは BaoCut から削除されたため、新しいセッションを開けません。',
  resumeCompleted: '実行回数の上限に達しています。上限を引き上げてから再開してください。',
  runStopped: '完了する前に停止しました',
};
