import type { ClientConnectionMessages } from './client-connection.ts';

export const ko: ClientConnectionMessages = {
  closed: '클라이언트가 닫혔습니다',
  disconnected: 'Runtime과의 연결이 끊겼습니다',
  connectionLost: '연결 끊김',
  cannotConnect: 'Runtime에 연결할 수 없습니다',
  requestTimedOut: (p) => `요청 시간 초과: ${p.method}`,
  unknownError: '알 수 없는 오류',
};
