import type { ServicesMessages } from './services.ts';

export const ko: ServicesMessages = {
  portRange: '1024–65535 사이의 포트 번호를 입력하세요',
  portTaken: (port, service) => `${port}번 포트는 이미 “${service}”에서 사용 중입니다. 다른 포트를 선택하세요`,
  browser: '브라우저',
  sessionMeta: (connections, ago, expires) =>
    [connections ? `연결 ${connections}개` : '연결 없음', `${ago} 활동`, expires ? `${expires}에 만료` : null].filter(Boolean).join(' · '),
  runtime: { connected: '연결됨', incompatible: '호환되지 않는 버전', disconnected: '연결 안 됨' },
};
