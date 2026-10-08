import type { ServicesMessages } from './services.ts';

export const zhHans: ServicesMessages = {
  portRange: '端口要填 1024–65535 之间的数字',
  portTaken: (port, service) => `${port} 已经留给「${service}」，换一个端口`,
  browser: '浏览器',
  sessionMeta: (connections, ago, expires) =>
    `${connections ? `${connections} 个连接` : '没有连接'} · ${ago}活跃${expires ? ` · ${expires} 过期` : ''}`,
  runtime: { connected: '已连接', incompatible: '版本不兼容', disconnected: '未连接' },
};
