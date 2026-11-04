import type { DriversCodexMessages } from './drivers-codex.ts';

export const zhHans: DriversCodexMessages = {
  plan: 'ChatGPT Plus 或 Pro 订阅',
  installHint: '安装 Codex CLI',
  signedOut: (p) => `Codex 未登录：在终端运行 codex login。${p.detail ? `（${p.detail}）` : ''}`,
  loginCheckFailed: (p) => `无法检查 Codex 的登录状态：${p.command} login status 运行失败。BaoCut 会带着 login status、app-server 这类子命令运行这个程序，包装脚本要把参数原样传下去。${p.detail ? `（${p.detail}）` : ''}`,
  customProvider: '自定义模型提供方',
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
