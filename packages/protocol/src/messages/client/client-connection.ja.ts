import type { ClientConnectionMessages } from './client-connection.ts';

export const ja: ClientConnectionMessages = {
  closed: 'クライアントは閉じられています',
  disconnected: 'Runtime との接続が切断されました',
  connectionLost: '接続が切断されました',
  cannotConnect: 'Runtime に接続できません',
  requestTimedOut: (p) => `リクエストがタイムアウトしました：${p.method}`,
  unknownError: '不明なエラー',
};
