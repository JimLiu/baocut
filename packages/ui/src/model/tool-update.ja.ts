import type { ToolUpdateMessages } from './tool-update.ts';

export const ja: ToolUpdateMessages = {
  standalone: '公式スタンドアロンバイナリ',
  updateInTerminal: 'ターミナルで更新',
  unknownInstall: 'この yt-dlp のインストール方法を判別できません。インストールしたときの方法に合ったコマンドを実行し、「再確認」をクリックしてください。',
  cannotRun: 'BaoCut はこのコマンドを代わりに実行できません。',
  thenRecheck: 'その後「再確認」をクリックしてください。',
  runThenRecheck: 'ターミナルでこのコマンドを実行し、「再確認」をクリックしてください。',
  updateWith: (method) => `${method} で更新`,
  stoppedTitle: '更新を停止しました',
  stoppedBody: 'コマンドは途中までしか実行されていない可能性があります。下の出力を確認し、「再確認」をクリックして現在の yt-dlp のバージョンを確かめてください。',
  failedTitle: (exitCode) => (exitCode === null ? '更新が完了しませんでした' : `更新が完了しませんでした（終了コード ${exitCode}）`),
  failedBody: (error) =>
    `${error ? `${error.replace(/[。.]$/, '')}。` : ''}既存の yt-dlp に影響はありません。出力は下にあります。コマンドをコピーしてターミナルで実行し、「再確認」をクリックすることもできます。`,
  updatedTo: (version) => `${version} に更新しました`,
  upToDate: (version) => (version ? `最新です（${version}）` : '最新です'),
  logTruncated: '…（前の出力は省略しました。全出力はタスクの記録にあります）\n',
  logStopped: '（停止しました）',
  logExitCode: (exitCode) => `（終了コード ${exitCode}）`,
};
