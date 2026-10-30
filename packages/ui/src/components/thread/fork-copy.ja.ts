import type { ForkMessages } from './fork-copy.ts';

export const ja: ForkMessages = {
  button: 'このターンから分岐',
  fork: '新しいセッションで続ける',
  forkHint: 'このターンまでの会話を引き継ぎます',
  restore: '続けて、動画をその時点に戻す…',
  restoreOne: (name) => `「${name}」をこのターンの終了時に戻します`,
  restoreMany: (n) => `${n} 本の動画をこのターンの終了時に戻します`,
  restoreNone: 'その時点のバージョンは残っていないか読み取れません',
  checking: 'バージョン履歴を確認中…',
  dialogTitle: '分岐して動画をその時点に戻す',
  dialogLead:
    '新しいセッションはこのターンまでの会話を引き継ぎます。下の動画はこのターンの終了時に戻ります。戻す操作は新しいバージョンとして保存され、バージョン履歴から元に戻せます。',
  listLabel: 'その時点に戻す動画',
  cancel: 'キャンセル',
  confirm: '分岐して戻す',
  ok: (version, undone) =>
    `バージョン ${version} に戻します。それ以降の ${undone} 個のバージョン（あなたと他のセッションの変更）は取り消されます`,
  pruned: 'その時点のバージョンはもうありません（バージョン履歴には最近のものと保存したものだけが残ります）',
  createdAfter: 'この動画はこのターンの後に作られたため、そのままにします',
  chainBroken: 'バージョン履歴をその時点まで読み取れません',
  done: '新しいセッションに分岐しました',
  doneRestored: (n) => `新しいセッションに分岐し、${n} 本の動画をその時点に戻しました。バージョン履歴から元に戻せます`,
  failed: (error) => `分岐できませんでした：${error}`,
  forkedFrom: (title, turn) => `「${title}」から分岐 · 第 ${turn} ターンまで`,
  sourceDeleted: '（元のセッションは削除済み）',
  history: (turns, omitted) => `引き継いだ履歴 · ${turns} ターン${omitted ? `（それ以前の ${omitted} ターンは省略）` : ''}`,
  hideHistory: '履歴を閉じる',
};
