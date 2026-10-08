import type { RcServicesMessages } from './rc-services.ts';

export const ko: RcServicesMessages = {
  mcpServiceLabel: 'MCP 서비스',
  nodeServiceLabel: 'LAN 노드',
  serviceNotAvailable: (p: { serviceId: string }) => `이 버전은 아직 “${p.serviceId}” 서비스를 제공하지 않습니다`,
  serviceNotFound: (p: { serviceId: string }) => `“${p.serviceId}” 서비스가 없습니다`,
  runtimeStopping: 'Runtime을 중지하는 중입니다',
  clientNotFound: '해당 클라이언트가 없습니다',
  portInUse: (p: { port: number }) => `포트 ${p.port}이(가) 이미 사용 중입니다`,
  cannotListen: (p: { port: number; reason: string }) => `포트 ${p.port}에서 수신 대기할 수 없습니다: ${p.reason}`,
  configFileInvalid: (p: { file: string }) => `서비스 설정 파일 형식이 잘못되었습니다: ${p.file}`,
  routingOnlyForModelApi: 'routing과 maxConcurrentPerClient는 모델 API 서비스(model-api)에만 적용됩니다',
  tokenPlaceholder: (p: { client: string }) => `<${p.client}의 토큰>`,
  tokenPlaceholderGeneric: '<토큰>',
  mcpNotRunning: 'MCP 서비스가 꺼져 있습니다. 먼저 시작하세요(baocut services start mcp). 그러지 않으면 클라이언트가 연결할 수 없습니다.',
  nodeServiceConfigure: '노드 서비스는 nodes.share.*(baocut share …)로 설정하세요',
  nodeServiceNotListening: '노드 서비스가 수신 대기 중이 아닙니다',
};
