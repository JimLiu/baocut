import type { DriversOpencodeMessages } from './drivers-opencode.ts';

export const ja: DriversOpencodeMessages = {
  plan: 'OpenCode のモデルアカウント',
  installHint: 'npm install -g @opencode/cli で 2.x をインストールしてください',
  unsupportedMajor: (p) => `OpenCode ${p.version} は BaoCut がまだ対応していないメジャーバージョンです。対応しているのは 2.x のみです。`,
  tooOld: (p) => `OpenCode ${p.version} は古すぎます。アップグレードしてください：BaoCut には ${p.min} 以降の 2.x が必要です（${p.command}）。`,
  unsupportedVersion: (p) => `OpenCode ${p.version} には対応していません。${p.min} 以降の 2.x が必要です`,
  versionUnknown: '不明なバージョン',
  noModelAccount: (p) =>
    `OpenCode にはまだモデルアカウントが接続されていないため、OpenCode Zen の無料モデルしか使用できません。ターミナルで ${p.command} を実行して接続してください。`,
  probeFailed: (p) => `OpenCode serve を起動できないか、モデル一覧を読み取れませんでした：${p.error}`,
  externalDirectory: '作業フォルダの外にある場所にアクセス',
  directoryNotReady: (p) => `OpenCode が ${p.seconds} 秒以内にフォルダ ${p.directory} の準備を完了しませんでした`,
  httpFailed: (p) => `OpenCode の ${p.operation} が失敗しました（HTTP ${p.status}${p.tag ? ` ${p.tag}` : ''}）${p.detail ? `：${p.detail}` : ''}`,
  htmlResponse: 'v2 API ではなく Web ページが返されました（バージョンが非互換？）',
  processExited: 'OpenCode のプロセスは終了しています',
  killedBySignal: (p) => `シグナル ${p.signal} で終了しました`,
  exitCode: (p) => `終了コード ${p.code}`,
  serveNotReady: (p) => `opencode serve が ${p.seconds} 秒以内に準備できませんでした`,
  serveExitedAtStart: (p) => `opencode serve が起動中に終了しました（${p.reason}）`,
  serveExited: 'opencode serve が終了しました',
  streamConnectFailed: (p) => `イベントストリームに接続できませんでした（HTTP ${p.status}）`,
  streamEnded: 'イベントストリームが終了しました',
  streamNotConnected: (p) => `イベントストリームが接続されませんでした（${p.seconds} 秒）`,
  streamLost: (p) => `イベントストリームが切断されました：${p.error}`,
  mcpFailed: (p) => `${p.name} は MCP サーバ ${p.server} に接続できませんでした（${p.error}）。このセッションでは BaoCut のツールを使用できません。`,
  mcpTimeout: (p) =>
    `${p.name} は時間内に MCP サーバ（${p.servers}）に接続できませんでした。このセッションでは BaoCut のツールを使用できない可能性があります。`,
  promptRejected: (p) => `${p.name} はこのメッセージを受け付けませんでした：${p.error}`,
  setModeFailed: (p) => `${p.name} のアクセスモードを設定できませんでした：${p.error}`,
  retryFallback: 'モデルへのリクエストが失敗しました。まもなく再試行します。',
  runFailed: (p) => `${p.name} の実行が失敗しました`,
  endedAfterRejection: (p) =>
    `ツールが拒否されたため、${p.name} はこのターンを終了しました。別の方法を試させたい場合は、もう一度メッセージを送信してください。`,
  interruptedTurn: (p) => `${p.name} はこのターンを中断しました（${p.reason}）。`,
  modelFormat: (p) => `${p.name} のモデルは provider/model の形式で指定する必要があります（受け取った値：${p.id}）`,
};
