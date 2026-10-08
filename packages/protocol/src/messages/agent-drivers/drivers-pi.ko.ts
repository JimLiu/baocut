import type { DriversPiMessages } from './drivers-pi.ts';

export const ko: DriversPiMessages = {
  plan: 'Pi의 모델 계정',
  installHint: 'npm으로 Pi를 설치하세요(npm install -g @earendil-works/pi-coding-agent, Node.js 필요)',
  signedOut: 'Pi에 로그인되어 있지 않습니다. 터미널에서 pi를 실행하고 /login을 입력하거나, 모델 공급자의 API 키(예: ANTHROPIC_API_KEY)를 설정하세요.',
  rpcFailed: (p) => `Pi의 RPC 모드를 시작하지 못했습니다: ${p.error}`,
  processStartFailed: (p) => `Pi 프로세스를 시작하지 못했습니다: ${p.error}`,
  processExited: (p) => `Pi 프로세스가 종료되었습니다(코드 ${p.code}, 시그널 ${p.signal})${p.tail ? `: ${p.tail}` : ''}`,
  processClosed: 'Pi 프로세스가 닫혔습니다',
  requestTimeout: (p) => `Pi가 ${p.ms} ms 안에 ${p.command} 요청에 응답하지 않았습니다`,
  stdinUnwritable: 'Pi의 stdin에 쓸 수 없습니다',
  commandFailed: (p) => `Pi의 ${p.command} 명령이 실패했습니다`,
  toolFallback: '도구',
  sessionFileMissing: '세션 파일을 찾을 수 없음',
  withStderr: (p) => `${p.error}(${p.tail})`,
  mcpNameInvalid: (p) =>
    `MCP 서버 이름 ${p.name}에 Pi가 허용하지 않는 문자가 있어(영문자, 숫자, _, -만 허용) 이 세션에서 사용할 수 없습니다.`,
  modelFormat: (p) => `Pi 모델은 provider/id 형식으로 써야 합니다: ${p.model}`,
  switchModelFailed: (p) => `Pi가 ${p.model} 모델로 전환하지 못했습니다: ${p.error}`,
  effortUnsupported: (p) => `Pi에는 “${p.level}” 추론 강도가 없어 이번 턴은 현재 설정을 사용합니다.`,
  effortFailed: (p) => `Pi가 추론 강도를 설정하지 못해(${p.error}) 이번 턴은 현재 설정을 사용합니다.`,
  mcpConnectFailed: (p) =>
    `Pi가 BaoCut의 MCP 서버에 연결하지 못해 이 세션에서는 BaoCut 도구(프로젝트·자막 읽기와 쓰기 등)를 사용할 수 없습니다: ${p.error}`,
  extensionError: (p) => `Pi 확장 프로그램에서 오류가 발생했습니다: ${p.error}`,
  modelCallFailed: 'Pi의 모델 호출이 실패했습니다',
  notice: (p) => `Pi: ${p.message}`,
  extensionAsked: (p) =>
    `Pi 확장 프로그램이 질문하려 했습니다${p.title ? `(“${p.title}”)` : ''}. BaoCut은 아직 이런 질문을 전달할 수 없어 대신 취소했습니다.`,
  fullAccessOnly: (p) =>
    `Pi는 동작마다 먼저 확인할 방법이 없어 BaoCut은 “${p.mode}” 모드로만 실행할 수 있습니다. 명령을 실행하거나 파일을 바꾸기 전에 확인하지 않습니다.`,
};
