import type { RcGatewayMessages } from './rc-gateway.ts';

export const ko: RcGatewayMessages = {
  helloTimeout: '핸드셰이크 시간이 초과되었습니다',
  textFramesOnly: '텍스트 프레임만 받습니다',
  frameNotJson: '프레임이 올바른 JSON이 아닙니다',
  frameUnrecognized: '인식할 수 없는 프레임입니다',
  unknownMethod: (p: { method: string }) => `알 수 없는 메서드: ${p.method}`,
  invalidParams: '잘못된 매개변수입니다',
  helloRequired: '첫 프레임은 hello여야 합니다',
  invalidToken: '잘못된 토큰입니다',
  protocolMismatch: (p: { client: string; runtime: string }) => `프로토콜 버전이 호환되지 않습니다: 클라이언트 ${p.client}, Runtime ${p.runtime}`,
  internalError: '내부 오류',
  catalogLocalOnly: '도구 카탈로그는 로컬 CLI와 데스크톱 앱에서만 사용할 수 있습니다',
};
