import type { DriversCodexMessages } from './drivers-codex.ts';

export const zhHans: DriversCodexMessages = {
  plan: 'ChatGPT Plus 或 Pro 订阅',
  installHint: '安装 Codex CLI',
  signedOut: (p) => `Codex 未登录：在终端运行 codex login。${p.detail ? `（${p.detail}）` : ''}`,
  chatgptAccount: 'ChatGPT 账号',
  apiKey: 'OpenAI API 密钥',
  accessToken: '访问令牌',
  workloadIdentity: '工作负载身份',
  codexAccount: 'Codex 账号',
  steerMismatch: (p) => `Codex 对 turn/steer 的应答不对：期望回合 ${p.expected}，收到 ${p.received}`,
  appServerExited: (p) => `codex app-server 退出（code ${p.code}，signal ${p.signal}）${p.stderr ? `\n${p.stderr}` : ''}`,
  connectionClosed: 'codex app-server 连接已关闭',
  requestTimeout: (p) => `codex app-server 请求超时：${p.method}`,
  appServerGone: 'codex app-server 已退出',
};
