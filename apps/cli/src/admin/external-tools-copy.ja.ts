import type { ToolsMessages } from './external-tools-copy.ts';

export const ja: ToolsMessages = {
  help: `使い方：
  baocut external-tools [list]     外部ツール（yt-dlp、ffmpeg）：状態、バージョン、パス、
                                   入手元、使用に同意済みかどうか
  baocut external-tools detect [name]
                                   再検出
  baocut external-tools install <name> [--yes]
                                   管理コピーを Runtime Home の tools/ にダウンロード：入手元、バージョン、サイズ、
                                   ライセンスを表示し、確認後にダウンロードして sha256 を検証します（--yes は同意を意味します）。
                                   ダウンロード元：設定 tools.downloadEndpoint と環境変数 BAOCUT_TOOLS_ENDPOINT
  baocut external-tools update <name> [--yes]
                                   システムにあるコピーをインストール時と同じ方法（Homebrew、pipx、pip、または公式の
                                   スタンドアロンプログラム）で更新：実行するコマンド全体を表示し、確認後に Runtime が
                                   実行します（--yes で確認）。出力を 1 行ずつ表示し、終了後に再検出します。管理者権限が
                                   必要なコマンドは表示するだけなので、ターミナルで自分で実行してください
  baocut external-tools path <name> <file>|--clear
                                   自分でインストールしたコピーを使う（--version を一度実行して確認します）。--clear で指定を解除
  baocut external-tools remove <name>
                                   管理コピーを削除（システムのコピーと指定パスはそのまま）
  baocut external-tools consent <name> [--revoke]
                                   ダウンロードツールの使用に同意、または同意を撤回（撤回後はリンクからの読み込みを拒否します）`,
  usage:
    '使い方：baocut external-tools [list] | detect [name] | install <name> [--yes] | update <name> [--yes] | path <name> <file>|--clear | remove <name> | consent <name> [--revoke]',
  clearOrFile: '--clear とファイルはどちらか一方だけを指定してください',
  stateLabels: {
    installed: 'インストール済み',
    missing: '未インストール',
    outdated: '更新あり',
    unavailable: '利用不可',
  },
  sourceLabels: {
    system: 'システムの PATH',
    user: '指定パス',
    managed: 'BaoCut がダウンロードしたコピー',
    env: '環境変数',
  },
  updateMethodLabels: {
    homebrew: 'Homebrew',
    pipx: 'pipx',
    pip: 'pip',
    standalone: '公式スタンドアロン版',
    winget: 'winget',
    scoop: 'Scoop',
    chocolatey: 'Chocolatey',
  },
  statusHead: (name: string, state: string, version: string | null, source: string | null, purpose: string) =>
    `${name}  ${state}${version ? ` ${version}` : ''}${source ? `（${source}）` : ''}  ${purpose}`,
  pathLine: (path: string) => `  パス：${path}`,
  userPathLine: (path: string) => `  指定パス：${path}`,
  managedLine: (version: string, path: string) => `  管理コピー：${version}  ${path}`,
  consentLine: (label: string) => `  同意：${label}`,
  installingLine: (jobId: string) => `  インストール中：タスク ${jobId}`,
  updatingLine: (jobId: string) => `  更新中：タスク ${jobId}`,
  updateLine: (command: string, method: string, runnable: boolean) =>
    `  更新：${command}（${method}${runnable ? '' : '、ターミナルで自分で実行してください'}）`,
  reasonLine: (reason: string) => `  理由：${reason}`,
  remedyLine: (remedy: string) => `  対処：${remedy}`,
  consentMissing: (name: string) => `まだ同意していません（使用前に同意してください：baocut external-tools consent ${name}）`,
  consentVia: { agent: 'Agent の承認経由', cli: 'CLI で', app: 'アプリで' },
  consentGranted: (at: string, via: string) => `同意済み（${at}、${via}）`,
  consentRevoked: (at: string) => `撤回済み（${at}）`,
  noTools: '登録されている外部ツールはありません',
  cannotUpdate: (label: string, reason: string) => `${label} を代わりに更新できません：${reason}`,
  runInTerminal: 'ターミナルで次を実行してください：',
  redetect: (name: string) => `その後、再確認してください：baocut external-tools detect ${name}`,
  updatePlanHead: (method: string, label: string, version: string | null) =>
    `${label}${version ? ` ${version}` : ''} をインストール時と同じ方法（${method}）で更新します`,
  runLine: (command: string) => `  実行：${command}`,
  updatePrompt: (label: string) => `このコンピュータでこのコマンドを実行して ${label} を更新しますか？[y/N] `,
  omittedLines: (n: number) => `…（${n} 行省略）`,
  updated: (label: string, before: string | null, after: string) => `${label} を更新しました：${before ?? '不明なバージョン'} → ${after}`,
  upToDate: (label: string, version: string | null) => `${label} は最新です${version ? `（${version}）` : ''}`,
  sizeEstimated: (size: string) => `約 ${size}（サイズ不明、推定値）`,
  sizeAbout: (size: string) => `約 ${size}`,
  willDownload: (label: string, version: string) => `${label} ${version} をダウンロードします`,
  sourceLine: (url: string | null) => `  入手元：${url ?? '（このコンピュータ向けのファイルはありません）'}`,
  sizeLine: (size: string) => `  サイズ：${size}`,
  licenseLine: (license: string) => `  ライセンス：${license}`,
  homepageLine: (url: string) => `  ホームページ：${url}`,
  sha256Line: (hash: string) => `  sha256：${hash}`,
  blockedLine: (reason: string) => `  ダウンロードできません：${reason}`,
  installPrompt: (label: string, version: string, size: string) => `${label} ${version}（${size}）をダウンロードして使用しますか？[y/N] `,
  noExternalTool: (name) => `外部ツール「${name}」はありません`,
  alreadyInstalling: (jobId) => `すでにインストール中です（タスク ${jobId}）。進行状況を表示します`,
  installDone: 'インストール完了',
  notDownloadedByBaoCut: (label, remedy) => `${label} は BaoCut ではダウンロードしません：${remedy ?? '自分でインストールしてください'}`,
  cannotDownload: (label, reason) => `${label} をダウンロードできません：${reason}`,
  notTtyAgreeDownload: 'ターミナルで実行されていません：ユーザがダウンロードに同意したら --yes を付けてください',
  notTtyConfirmRun: 'ターミナルで実行されていません：ユーザが実行を確認したら --yes を付けてください',
  notDownloaded: 'ダウンロードしていません',
  notRun: '実行していません',
  remedy: (remedy) => `対処：${remedy}`,
  partialDownloadKept: (name) => `ダウンロード済みの部分は残してあります：baocut external-tools install ${name} で再開できます`,
  alreadyUpdating: (jobId) => `すでに更新中です（タスク ${jobId}）。出力を表示します`,
  managedCopy: (label, name) =>
    `使用中の ${label} は BaoCut がダウンロードしたコピーです：バージョンを変えるには baocut external-tools install ${name} を使ってください`,
  unknownInstall: (file, name) =>
    `${file} のインストール方法を判別できません：インストール時と同じ方法でターミナルから更新し、その後 baocut external-tools detect ${name} を実行してください`,
  noRunnableTool: (label, remedy) => `実行できる ${label} が見つかりません：${remedy}`,
  updateManual: (label, command) => `${label} の更新はターミナルで自分で行う必要があります：${command}`,
  partialCommand: (name) =>
    `コマンドが途中までしか実行されていない可能性があります：baocut external-tools detect ${name} で現在のバージョンを確認してください`,
};
