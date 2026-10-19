import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const ja: ProjectSettingsMessages = {
  menuItem: 'プロジェクト設定…',
  title: 'プロジェクト設定',
  close: 'プロジェクト設定を閉じる',
  done: '完了',
  loading: 'git を確認中',
  loadFailed: (message: string) => `git を確認できませんでした：${message}`,

  gitHeading: 'git',
  gitLead:
    'BaoCut は、動画のワークスペーススナップショットを、プロジェクトがある git リポジトリにコミットできます。バージョン履歴は git を必要とせず、リポジトリの外でも同じように使えます。',
  branch: (name: string) => `ブランチ ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: '再確認',
  sentences: (first: string, second: string | null) => (second ? `${first}。${second}。` : `${first}。`),

  lightReady: '準備完了',
  lightPaused: (label: string) => `一時停止中 · ${label}`,
  lightNotRepo: 'git リポジトリ外',
  lightUnavailable: 'git が見つかりません',
  lightError: 'git が失敗しました',
  pauseLocked: 'リポジトリが使用中',
  pauseMerge: 'マージ中',
  pauseRebase: 'リベース中',
  pauseCherryPick: 'チェリーピック中',
  pauseRevert: 'リバート中',
  pauseBisect: 'bisect 中',
  pauseDetached: 'HEAD が切り離し状態',
  pauseLocalConfig: 'ローカルフィルタあり',
  pauseLocalConfigChanged: 'ローカルフィルタが変更済み',

  pausedHeading: (label: string) => `コミットを一時停止中：${label}`,
  pausedNote: 'コミットの一時停止中は、自動コミットと「git にコミット」が待機します。開く、編集する、バージョン履歴を使う操作には影響しません。',
  errorHeading: 'git が失敗しました',
  unavailableHeading: 'git が見つかりません',

  lcEntry: '項目',
  lcValue: '実行するコマンドまたは読み込むファイル',
  lcExplain:
    '許可すると、BaoCut は git を実行するときにこれらの項目に従います（例：git-crypt による暗号化）。許可はプロジェクトではなくこのコンピュータにだけ保存され、項目や読み込むファイルが変わると BaoCut は再び一時停止します。これはフォルダを信頼することではありません。開く、編集する、Agent の操作には影響しません。',
  lcWeb:
    'これらの項目は、BaoCut デスクトップアプリのプロジェクト設定でのみ表示・許可できます（または baocut projects git-allow を使います）。コミットの一時停止中も、開く、編集する、バージョン履歴を使う操作には影響しません。',
  allow: '許可',
  allowedTitle: 'ローカルフィルタを許可しました',
  allowedText: '許可はプロジェクトではなくこのコンピュータに保存されました。これでコミットできます。',
  allowFailed: '許可されませんでした',

  commit: 'git にコミット',
  committing: 'コミット中',
  commitDesc: (maxMiB: number) =>
    `BaoCut のファイルだけをコミットします：変更された動画のワークスペーススナップショットと、${maxMiB} MiB までの素材です。プロジェクト内のほかのファイルや、すでにステージした変更はそのまま残ります。BaoCut はプッシュしません。`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `前回のコミット ${commit} · ${auto ? '自動' : '手動'} · ${ago}`,
  lastFailed: (message: string) => `前回の試行は失敗しました：${message}`,
  committedTitle: 'git にコミットしました',
  committedText: (commit: string, files: number, videos: string[]) =>
    `${commit} をコミットしました：${files} 件のファイル${videos.length ? `、${videos.join('、')}` : ''}。`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `「${name}」` : from === to ? `「${name}」バージョン ${to}` : `「${name}」バージョン ${from}–${to}`,
  unnamedVideo: '名前のない動画',
  nothingTitle: 'コミットする変更はありません',
  nothingText: 'BaoCut のファイルは前回のコミット時と同じです。',
  commitFailed: 'コミットされませんでした',

  autoCommit: '自動コミット',
  autoCommitDesc:
    'プロジェクトで 5 分間操作がないとき、プロジェクトで最後に開いている動画を閉じたとき、または BaoCut を終了するときに 1 回コミットします。このコンピュータ上のすべてのプロジェクトでこの設定を共有します。',

  initTitle: 'git を初期化',
  initDesc: 'プロジェクトフォルダに git リポジトリを作成し、スナップショットをコミットできるようにします。',
  initWebNote: 'Runtime が動いているコンピュータのフォルダにリポジトリを作成できるのは、BaoCut デスクトップアプリまたは CLI（baocut projects git-init）だけです。',
  initRefused: (why: string) => `ここでは使用できません：${why}`,
  initRefusedNote: '必要な場合は、動画を専用のプロジェクトフォルダに移し、そこで git を初期化してください。',
  refusalHome: 'プロジェクトがホームフォルダです。ここにリポジトリを作ると、ほかのツールからはホームフォルダ内のすべてのフォルダがそのリポジトリの一部に見えてしまいます。',
  refusalUserFolder:
    'プロジェクトが標準のユーザフォルダ（デスクトップ、書類、ダウンロード、ムービー、ミュージック、ピクチャなど）です。ここにリポジトリを作ると、ほかのツールからはその中のすべてのフォルダがそのリポジトリの一部に見えてしまいます。',
  refusalVolumeRoot: 'プロジェクトがディスクのルートです。ここにリポジトリを作ると、ディスク全体がそのリポジトリの一部に見えてしまいます。',
  refusalInsideRepo: 'プロジェクトはすでに git リポジトリ内にあります。',
  initConfirmTitle: 'プロジェクトフォルダで git を初期化しますか？',
  initConfirmBody: (path: string) =>
    `${path} に git リポジトリを作成します。BaoCut の除外ルールはリポジトリ自身の .git/info/ に書き込まれるため、プロジェクト内のファイルは変わりません。コミットもプッシュも行いません。`,
  cancel: 'キャンセル',
  initDoneTitle: 'git を初期化しました',
  initDoneText: 'まだ何もコミットされていません。「git にコミット」で最初のコミットを作成してください。',
  initFailed: '初期化されませんでした',

  recheckSame: '変化はありません',
  recheckReadyTitle: 'コミットできます',
  recheckReadyText: 'リポジトリは一時停止状態ではなくなりました。',

  outsideHeading: 'プロジェクト外の素材',
  outsideLead:
    '動画がプロジェクトフォルダ外の素材を使っている場合、ワークスペーススナップショットにはその素材のパスが記録されます（ホームフォルダ内なら ~/ で始まるパス、それ以外はフルパス）。コミットやプッシュの後、ほかの人が受け取るのはパスだけで、ファイルは含まれません。素材も一緒に渡すには、ポータブルパッケージを使ってください。',

  stripLabel: 'プロジェクトの git',
  projectSettings: 'プロジェクト設定',
};
