import type { DataGrantsMessages } from './data-grants-copy.ts';

export const ja: DataGrantsMessages = {
  title: 'データ送信の許可',
  showEnded: (count: number) => `終了したものを表示（${count}）`,
  lead: 'クラウドプロバイダにデータを送るには許可が必要です。プロバイダを有効にすると既定で 1 件発行され、承認時に「常に許可」を選んだときにも 1 件発行されます。撤回すると新しい呼び出しではデータが送信されなくなりますが、送信済みのデータと発生済みの料金は取り戻せません。ローカルモデルには許可は不要です。',
  loading: '許可を読み込み中…',
  disconnected: 'Runtime に接続されていません',
  revoke: '撤回',
  noActive: '有効な許可はありません',
  none: '許可はまだありません',
  emptyDesc: 'クラウドプロバイダを有効にするか、承認時に「常に許可」を選ぶと、ここに許可が表示されます。',
  revokeTitle: (name: string) => `「${name}」を撤回しますか？`,
  revokeFailed: (message: string) => `撤回できませんでした：${message}`,
  cancel: 'キャンセル',
};
