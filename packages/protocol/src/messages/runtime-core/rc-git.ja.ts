import type { RcGitMessages } from './rc-git.ts';

export const ja: RcGitMessages = {
  gitPurpose: 'プロジェクト内の BaoCut のファイルを git にコミットします（任意）',
  gitMissingRemedyMac: 'git をインストールしてください：ターミナルで xcode-select --install を実行してコマンドラインツールを入れるか、Homebrew でインストールします（brew install git）',
  gitMissingRemedyWin: 'https://git-scm.com/download/win から Git for Windows をインストールしてください',
  gitMissingRemedyLinux: 'パッケージマネージャで git をインストールしてください',
  xcodeStub: 'コマンドラインツールをインストールするまで、/usr/bin/git はそのインストールを促すだけです',

  notRepo: 'このプロジェクトは git リポジトリ内にありません',
  initRemedy: 'プロジェクトフォルダで baocut projects git-init を実行するか、リポジトリを置きたい場所で自分で git init を実行してください',
  initHome: 'BaoCut はホームフォルダに git リポジトリを作りません：その中のすべてのフォルダが、ほかのツールからは 1 つのリポジトリの一部に見えてしまいます',
  initUserFolder: (p) => `BaoCut は標準のユーザフォルダ（${p.path}）に git リポジトリを作りません：その中のすべてのフォルダが、ほかのツールからは 1 つのリポジトリの一部に見えてしまいます`,
  initVolumeRoot: 'BaoCut はボリュームやドライブのルートに git リポジトリを作りません',
  initInsideRepo: 'このプロジェクトはすでに git リポジトリ内にあります',
  initElsewhere: 'まずプロジェクトを専用のフォルダに移すか、リポジトリを置きたい場所でご自身で git init を実行してください',
  pausedLocked: 'リポジトリは別の git コマンドが使用中です（index.lock があります）',
  lockedRemedy: '別の git コマンドが終わるまで待ってください。BaoCut は次のコミット時に再試行し、ロックファイルは決して削除しません。git コマンドが動いていない場合はご自身でロックを削除してください',
  pausedMerge: 'リポジトリはマージの途中です',
  pausedRebase: 'リポジトリはリベースの途中です',
  pausedCherryPick: 'リポジトリはチェリーピックの途中です',
  pausedRevert: 'リポジトリはリバートの途中です',
  pausedBisect: 'リポジトリは bisect の途中です',
  pausedDetached: 'HEAD が切り離されています（リポジトリがどのブランチにもいません）',
  repoStateRemedy: 'git で完了するか中止してください。その後 BaoCut はコミットを再開します',
  detachedRemedy: 'git でブランチに切り替えてください。その後 BaoCut はコミットを再開します',
  pausedLocalConfig: 'リポジトリのローカル設定がプログラムを実行するか別のファイルを読み込む（フィルタまたは include）ため、BaoCut はファイルを読む git コマンドを実行しません',
  pausedLocalConfigChanged: '許可した後でリポジトリのローカルフィルタまたは include が変更されたため、BaoCut は代理コミットを再び一時停止しました',
  localConfigRemedy: '項目と実行されるコマンドを確認してから、baocut projects git-allow で許可してください',
  gitFailed: (p) => `このリポジトリで git が失敗しました：${p.detail}`,

  manageOnlyInAppOrCli: 'git の初期化とローカルフィルタの許可は、デスクトップアプリまたは CLI でのみ行えます',
  digestChanged: '確認した後でローカル設定が変更されました。項目をもう一度確認してください',
  commitFailed: (p) => `git へのコミットに失敗しました：${p.detail}`,
  initFailed: (p) => `git の初期化に失敗しました：${p.detail}`,

  commitSummary: (p) => `プロジェクト「${p.name}」内の BaoCut のファイルを git にコミット`,
  commitTitle: (p) => `BaoCut: ${p.names} を更新`,
};
