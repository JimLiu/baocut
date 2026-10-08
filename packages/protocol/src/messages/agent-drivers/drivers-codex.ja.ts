import type { DriversCodexMessages } from './drivers-codex.ts';

export const ja: DriversCodexMessages = {
  plan: 'ChatGPT Plus または Pro サブスクリプション',
  installHint: 'Codex CLI をインストールしてください',
  signedOut: (p) => `Codex はサインインしていません。ターミナルで codex login を実行してください。${p.detail ? `（${p.detail}）` : ''}`,
  chatgptAccount: 'ChatGPT アカウント',
  apiKey: 'OpenAI API キー',
  accessToken: 'アクセストークン',
  workloadIdentity: 'ワークロード ID',
  codexAccount: 'Codex アカウント',
  steerMismatch: (p) => `Codex から予期しない turn/steer の応答がありました：ターン ${p.expected} を想定していましたが、${p.received} を受け取りました`,
  appServerExited: (p) => `codex app-server が終了しました（code ${p.code}、signal ${p.signal}）${p.stderr ? `\n${p.stderr}` : ''}`,
  connectionClosed: 'codex app-server との接続は閉じられています',
  requestTimeout: (p) => `codex app-server へのリクエストがタイムアウトしました：${p.method}`,
  appServerGone: 'codex app-server は終了しています',
};
