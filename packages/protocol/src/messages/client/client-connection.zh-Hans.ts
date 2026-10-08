import type { ClientConnectionMessages } from './client-connection.ts';

export const zhHans: ClientConnectionMessages = {
  closed: '客户端已关闭',
  disconnected: '与 Runtime 的连接已断开',
  connectionLost: '连接断开',
  cannotConnect: '无法连接 Runtime',
  requestTimedOut: (p) => `请求超时：${p.method}`,
  unknownError: '未知错误',
};
