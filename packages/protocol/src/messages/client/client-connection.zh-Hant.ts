import type { ClientConnectionMessages } from './client-connection.ts';

export const zhHant: ClientConnectionMessages = {
  closed: '用戶端已關閉',
  disconnected: '與 Runtime 的連線已中斷',
  connectionLost: '連線中斷',
  cannotConnect: '無法連線到 Runtime',
  requestTimedOut: (p) => `請求逾時：${p.method}`,
  unknownError: '未知的錯誤',
};
