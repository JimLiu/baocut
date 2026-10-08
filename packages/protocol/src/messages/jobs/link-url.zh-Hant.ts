import type { JobsLinkUrlMessages } from './link-url.ts';

export const zhHant: JobsLinkUrlMessages = {
  startsWithDash: '連結不能以 - 開頭',
  invalidLink: '不是有效的連結',
  httpOnly: '只接受 http(s):// 連結',
  credentials: '連結不能包含使用者名稱或密碼',
  noHost: '連結沒有主機名稱',
  privateAddress: '無法從本機、鏈路本機或私人網路位址匯入',
  redacted: '[連結]',
  unresolvable: (p: { host: string }) => `無法解析主機名稱 ${p.host}：請檢查網路與連結`,
  noAddresses: (p: { host: string }) => `主機名稱 ${p.host} 沒有任何位址`,
  resolvesPrivate: (p: { host: string }) => `${p.host} 解析為本機、鏈路本機或私人網路位址，無法從它匯入`,
};
