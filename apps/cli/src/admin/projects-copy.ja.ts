import type { ProjectsMessages } from './projects-copy.ts';

export const ja: ProjectsMessages = {
  help: `使い方：
  baocut projects git-status [<プロジェクト>]
                                   プロジェクトの git の状態：リポジトリ、ブランチ、BaoCut がコミットできるか、
                                   一時停止の理由（コミットは baocut projects git-commit）
  baocut projects git-init [<プロジェクト>]
                                   プロジェクトフォルダで git を初期化（ホームフォルダ、標準のユーザーフォルダ、
                                   ボリュームのルート、別のリポジトリの中では行いません）
  baocut projects git-allow [<プロジェクト>] [--yes]
                                   リポジトリのローカル設定にあるフィルターと include を表示してから許可します。
                                   許可するまで BaoCut はそれらを実行する git コマンドを実行しません
  baocut projects remove <プロジェクト> [--yes]
                                   BaoCut からプロジェクトを削除：セッションは削除され、フォルダとファイルはディスクに残ります
                                   （フォルダをもう一度開くとプロジェクトが戻ります）
  <プロジェクト> はプロジェクト ID、名前、フォルダ。省略すると現在のフォルダを含むプロジェクト`,
  noProject: (cwd) => `${cwd} を含むプロジェクトはありません。プロジェクト ID、名前、フォルダを指定してください（baocut projects list）`,
  unknownProject: (text) => `プロジェクトが見つかりません：${text}（baocut projects list）`,
  ambiguousProject: (text) => `${text} という名前のプロジェクトが複数あります。ID で指定してください`,
  states: {
    ready: '準備完了',
    paused: '一時停止中',
    'not-repo': 'git リポジトリにありません',
    unavailable: 'git を使用できません',
    error: 'エラー',
  },
  head: (name, id) => `プロジェクト ${name}（${id}）`,
  state: (state) => `Git：${state}`,
  branch: (branch) => `ブランチ：${branch}`,
  detached: 'ブランチ：（HEAD が切り離されています）',
  version: (version) => `git のバージョン：${version}`,
  repo: (root) => `リポジトリ：${root}`,
  autoCommit: (on) => `自動コミット：${on ? 'オン' : 'オフ'}`,
  lastCommit: (commit, auto, at) => `最後のコミット：${commit.slice(0, 12)}（${auto ? '自動' : '手動'}、${at}）`,
  lastError: (message) => `最後のエラー：${message}`,
  entriesHead: 'ローカルのフィルターと include：',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  （${file}）` : ''}`,
  allowHint: '確認してから baocut projects git-allow で許可してください',
  initDone: (root) => `${root} で git を初期化しました`,
  nothingToAllow: 'このリポジトリには許可を待っているローカルのフィルターや include はありません',
  allowPrompt: 'これらの項目を許可しますか？BaoCut はそれらを実行する git コマンドを実行します [y/N] ',
  notTtyAllow: 'ターミナルではありません：baocut projects git-status で項目を確認してから --yes を付けて再実行してください',
  notAllowed: '許可しませんでした：このリポジトリでの BaoCut のコミットは一時停止のままです',
  allowed: '許可しました：BaoCut はこのリポジトリへのコミットを再開します',
  removeHead: (name, id, dir) => `プロジェクト ${name}（${id}）：${dir}`,
  removeMissing: 'フォルダが見つかりません',
  removeEffect: (count) => `削除すると、このプロジェクトの ${count} 件のセッションも削除されます。フォルダと動画・ファイルはディスクに残ります`,
  removePrompt: 'このプロジェクトを BaoCut から削除しますか？ [y/N] ',
  notTtyRemove: 'ターミナルではありません：baocut projects list でプロジェクトを確認してから、--yes を付けて再実行してください',
  notRemoved: '削除しませんでした',
  removed: (name, count) => `${name} を BaoCut から削除し、${count} 件のセッションを削除しました。フォルダはそのままです：もう一度開く（または baocut projects create <フォルダ> を実行する）とプロジェクトが戻ります`,
};
