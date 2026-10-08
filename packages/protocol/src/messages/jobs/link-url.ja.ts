import type { JobsLinkUrlMessages } from './link-url.ts';

export const ja: JobsLinkUrlMessages = {
  startsWithDash: 'リンクを - で始めることはできません',
  invalidLink: '有効なリンクではありません',
  httpOnly: 'http(s):// のリンクのみ受け付けます',
  credentials: 'リンクにユーザ名やパスワードを含めることはできません',
  noHost: 'リンクにホスト名がありません',
  privateAddress: 'ローカル、リンクローカル、プライベートネットワークのアドレスからは読み込めません',
  redacted: '[リンク]',
  unresolvable: (p: { host: string }) => `ホスト名 ${p.host} を解決できません：ネットワークとリンクを確認してください`,
  noAddresses: (p: { host: string }) => `ホスト名 ${p.host} にアドレスがありません`,
  resolvesPrivate: (p: { host: string }) =>
    `${p.host} はローカル、リンクローカル、またはプライベートネットワークのアドレスに解決されるため、読み込めません`,
};
