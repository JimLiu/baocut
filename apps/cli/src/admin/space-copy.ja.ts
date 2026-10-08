import type { SpaceMessages } from './space-copy.ts';

export const ja: SpaceMessages = {
  help: `使い方：
  baocut space rescan              ソースフォルダを再スキャン
  baocut space rebuild             ソースフォルダと記録から Space のカタログを再構築。
                                   コンテンツインデックスはバックグラウンドですべての動画を読み直します
  baocut space trash|restore <entry id>
                                   ゴミ箱に移動／ゴミ箱から復元（ファイルはそのまま。動画の項目では
                                   動画フォルダをゴミ箱に移動／ゴミ箱から戻します）
  baocut space purge <entry id>    ゴミ箱の項目を完全に削除。動画やタスクがまだ使っている場合は削除せず、
                                   参照元を一覧表示します
  baocut space delete-video <entry id>
                                   動画を削除：動画フォルダをゴミ箱に移動し、保持期間内なら復元できます。
                                   リンクした素材の元ファイルはそのまま
  baocut space continue <entry id> [--conversation <session id>]
                                   項目からセッションを続ける：参照（識別子とメタデータのみ）を次のメッセージに添えます。
                                   セッションを省略すると、項目の場所に応じて選ぶか新しく作成します`,
  usage: [
    '使い方：baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>',
    '        baocut space continue <entry id> [--conversation <session id>]',
  ].join('\n'),
  entryUsage: (action) => `使い方：baocut space ${action} <entry id>`,
  continueUsage: '使い方：baocut space continue <entry id> [--conversation <session id>]',
  flagNotAccepted: (action, key) => `baocut space ${action} では --${key} は使えません`,
  rescanStarted: '再スキャンを開始しました',
  rebuilt: (entries, pendingVideos) =>
    `カタログを再構築しました：${entries} 件の項目。コンテンツインデックスがバックグラウンドで ${pendingVideos} 本の動画を読み直しているため、完了するまで検索結果は不完全です`,
  purgeBlocked: (id) => `${id} はまだ動画またはタスクで使われているため、削除しませんでした`,
  movedToTrash: (id, name) => `ゴミ箱に移動しました：${id}  ${name}`,
  restoredFromTrash: (id, name) => `ゴミ箱から復元しました：${id}  ${name}`,
  purged: (id) => `${id} を完全に削除しました`,
  notPurged: (id) => `${id} は削除しませんでした：まだ参照されています`,
  videoTrashed: (name, entryId, retentionDays) =>
    `動画「${name}」をゴミ箱に移動しました：${entryId}（baocut space restore ${entryId} で復元${retentionDays === null ? '' : `。${retentionDays} 日後に完全に削除されます`}）`,
  relatedKept: (n) => `この動画から書き出し・生成した ${n} 件の項目は元の場所に残ります`,
  continued: (created, id, cwd) => `${created ? 'セッションを作成' : 'セッションを使用'} ${id}  作業フォルダ ${cwd}`,
  referenceNext: (name, id) => `項目「${name}」への参照を次のメッセージに添えます：baocut chat "…" --conversation ${id}`,
};
