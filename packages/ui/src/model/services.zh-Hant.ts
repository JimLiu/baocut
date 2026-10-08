import type { ServicesMessages } from './services.ts';

export const zhHant: ServicesMessages = {
  portRange: '請輸入 1024–65535 之間的連接埠號碼',
  portTaken: (port, service) => `${port} 已由「${service}」使用，請選擇其他連接埠`,
  browser: '瀏覽器',
  sessionMeta: (connections, ago, expires) =>
    `${connections ? `${connections} 個連線` : '沒有連線'} · ${ago}活動${expires ? ` · ${expires} 到期` : ''}`,
  runtime: { connected: '已連線', incompatible: '版本不相容', disconnected: '未連線' },
};
