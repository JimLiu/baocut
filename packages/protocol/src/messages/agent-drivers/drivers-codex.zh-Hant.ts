import type { DriversCodexMessages } from './drivers-codex.ts';

export const zhHant: DriversCodexMessages = {
  plan: 'ChatGPT Plus 或 Pro 訂閱',
  installHint: '安裝 Codex CLI',
  signedOut: (p) => `Codex 尚未登入。請在終端機執行 codex login。${p.detail ? `（${p.detail}）` : ''}`,
  chatgptAccount: 'ChatGPT 帳號',
  apiKey: 'OpenAI API 金鑰',
  accessToken: '存取權杖',
  workloadIdentity: '工作負載身分',
  codexAccount: 'Codex 帳號',
  steerMismatch: (p) => `Codex 對 turn/steer 的回應不符預期：預期回合 ${p.expected}，收到 ${p.received}`,
  appServerExited: (p) => `codex app-server 已結束（code ${p.code}，signal ${p.signal}）${p.stderr ? `\n${p.stderr}` : ''}`,
  connectionClosed: 'codex app-server 連線已關閉',
  requestTimeout: (p) => `codex app-server 請求逾時：${p.method}`,
  appServerGone: 'codex app-server 已結束',
};
