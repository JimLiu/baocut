import type { JobsLinkUrlMessages } from './link-url.ts';

export const zhHans: JobsLinkUrlMessages = {
  startsWithDash: '链接不能以 - 开头',
  invalidLink: '不是合法的链接',
  httpOnly: '只接受 http(s):// 的链接',
  credentials: '链接里不能带用户名或密码',
  noHost: '链接没有主机名',
  privateAddress: '不能从本机、链路本地或内网地址导入',
  redacted: '[链接]',
  unresolvable: (p: { host: string }) => `解析不了主机名 ${p.host}：检查网络与链接`,
  noAddresses: (p: { host: string }) => `主机名 ${p.host} 没有地址`,
  resolvesPrivate: (p: { host: string }) => `${p.host} 解析到本机、链路本地或内网地址，不能从它导入`,
};
