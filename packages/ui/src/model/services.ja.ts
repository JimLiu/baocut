import type { ServicesMessages } from './services.ts';

export const ja: ServicesMessages = {
  portRange: '1024〜65535 のポート番号を入力してください',
  portTaken: (port, service) => `${port} はすでに「${service}」が使用しています。別のポートを選んでください`,
  browser: 'ブラウザ',
  sessionMeta: (connections, ago, expires) =>
    [connections ? `接続 ${connections} 件` : '接続なし', `最終アクティブ ${ago}`, expires ? `有効期限 ${expires}` : null]
      .filter(Boolean)
      .join(' · '),
  runtime: { connected: '接続済み', incompatible: 'バージョンに互換性がありません', disconnected: '未接続' },
};
