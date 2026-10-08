import type { JobsLinkUrlMessages } from './link-url.ts';

export const ko: JobsLinkUrlMessages = {
  startsWithDash: '링크는 -로 시작할 수 없습니다',
  invalidLink: '올바른 링크가 아닙니다',
  httpOnly: 'http(s):// 링크만 받습니다',
  credentials: '링크에 사용자 이름이나 비밀번호를 넣을 수 없습니다',
  noHost: '링크에 호스트 이름이 없습니다',
  privateAddress: '로컬, 링크 로컬, 사설 네트워크 주소에서는 가져올 수 없습니다',
  redacted: '[링크]',
  unresolvable: (p: { host: string }) => `${p.host} 호스트 이름을 조회할 수 없습니다: 네트워크와 링크를 확인하세요`,
  noAddresses: (p: { host: string }) => `${p.host} 호스트 이름에 주소가 없습니다`,
  resolvesPrivate: (p: { host: string }) =>
    `${p.host} 호스트가 로컬, 링크 로컬, 사설 네트워크 주소로 조회되어 가져올 수 없습니다`,
};
