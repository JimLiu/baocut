import type { DriversPiMessages } from './drivers-pi.ts';

export const ja: DriversPiMessages = {
  plan: 'Pi のモデルアカウント',
  installHint: 'npm で Pi をインストールしてください（npm install -g @earendil-works/pi-coding-agent、Node.js が必要）',
  signedOut:
    'Pi はサインインしていません。ターミナルで pi を実行して /login を入力するか、モデルプロバイダの API キー（例：ANTHROPIC_API_KEY）を設定してください。',
  rpcFailed: (p) => `Pi の RPC モードを起動できませんでした：${p.error}`,
  processStartFailed: (p) => `Pi のプロセスを起動できませんでした：${p.error}`,
  processExited: (p) => `Pi のプロセスが終了しました（code ${p.code}、signal ${p.signal}）${p.tail ? `：${p.tail}` : ''}`,
  processClosed: 'Pi のプロセスは閉じられています',
  requestTimeout: (p) => `Pi が ${p.ms} ms 以内に ${p.command} に応答しませんでした`,
  stdinUnwritable: 'Pi の stdin に書き込めません',
  commandFailed: (p) => `Pi の ${p.command} が失敗しました`,
  toolFallback: 'ツール',
  sessionFileMissing: 'セッションファイルが見つかりません',
  withStderr: (p) => `${p.error}（${p.tail}）`,
  mcpNameInvalid: (p) =>
    `MCP サーバ名 ${p.name} に Pi が受け付けない文字が含まれているため（使用できるのは英字、数字、_、- のみ）、このセッションでは使用できません。`,
  modelFormat: (p) => `Pi のモデルは provider/id の形式で指定する必要があります：${p.model}`,
  switchModelFailed: (p) => `Pi をモデル ${p.model} に切り替えられませんでした：${p.error}`,
  effortUnsupported: (p) => `Pi には「${p.level}」の推論強度がないため、このターンは現在の設定で実行します。`,
  effortFailed: (p) => `Pi の推論強度を設定できなかったため（${p.error}）、このターンは現在の設定で実行します。`,
  mcpConnectFailed: (p) =>
    `Pi が BaoCut の MCP サーバに接続できなかったため、このセッションでは BaoCut のツール（プロジェクトや字幕の読み書きなど）を使用できません：${p.error}`,
  extensionError: (p) => `Pi の拡張機能でエラーが発生しました：${p.error}`,
  modelCallFailed: 'Pi のモデル呼び出しが失敗しました',
  notice: (p) => `Pi：${p.message}`,
  extensionAsked: (p) =>
    `Pi の拡張機能から質問がありました${p.title ? `（「${p.title}」）` : ''}。BaoCut はこの種の質問をまだ中継できないため、キャンセルしました。`,
  fullAccessOnly: (p) =>
    `Pi には操作ごとに確認する仕組みがないため、BaoCut は「${p.mode}」モードでしか実行できません。コマンドの実行やファイルの変更の前に確認はありません。`,
};
