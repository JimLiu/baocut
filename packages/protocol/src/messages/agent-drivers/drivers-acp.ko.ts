import type { DriversAcpMessages } from './drivers-acp.ts';

export const ko: DriversAcpMessages = {
  copilotPlan: 'GitHub Copilot 구독',
  copilotLoginHint: '터미널에서 copilot login을 실행해 로그인하세요(또는 copilot 대화형 모드에서 /login 입력)',
  copilotInstallHint: 'GitHub Copilot CLI를 설치하세요(npm install -g @github/copilot)',
  geminiPlan: 'Google 계정',
  geminiLoginHint: '터미널에서 gemini를 실행해 Google 계정 로그인을 선택하거나, ~/.gemini/.env에 GEMINI_API_KEY=… 항목을 넣으세요',
  geminiInstallHint: 'Gemini CLI를 설치하세요(brew install gemini-cli)',
  cursorPlan: 'Cursor 구독',
  cursorInstallHint: '공식 스크립트로 Cursor Agent를 설치하세요',
  grokPlan: 'xAI 계정',
  grokInstallHint: '공식 스크립트로 Grok CLI를 설치하세요',
  kimiPlan: 'Kimi 계정',
  kimiInstallHint: '공식 안내에 따라 Kimi Code를 설치하세요(https://github.com/MoonshotAI/kimi-code)',
  customNoCommand: (p) => `Agent ${p.id}에 명령이 없습니다`,
  customInstallHint: (p) => `${p.command} 명령이 설치되어 있고 PATH에 있는지 확인하거나, 절대 경로로 다시 추가하세요`,
  loginViaTerminal: (p) => `터미널에서 ${p.command} 명령을 실행해 로그인하세요`,
  loginPerInstructions: '안내에 따라 로그인하세요',
  signedOut: (p) => `${p.name}에 로그인되어 있지 않습니다: ${p.login}.${p.detail ? ` (${p.detail})` : ''}`,
  probeTimeout: (p) => `${p.name}이(가) ${p.seconds}초 안에 응답하지 않았습니다`,
  acpModeFailed: (p) => `${p.name}을(를) ACP 모드로 시작하지 못했습니다: ${p.error}`,
  exitCode: (p) => `종료 코드 ${p.code}`,
  exited: (p) => `${p.name}이(가) 종료되었습니다(${p.status})${p.tail ? `: ${p.tail}` : ''}`,
  exitedBeforeInit: (p) => `${p.name}이(가) 초기화 전에 종료되었습니다`,
  initTimeout: (p) => `${p.name}이(가) 제한 시간 안에 ACP 초기화를 마치지 못했습니다`,
  mcpHttpUnsupported: (p) =>
    `${p.name}은(는) HTTP로 MCP 서버에 연결할 수 없어 이 세션에서는 BaoCut 도구(프로젝트·자막 읽기와 편집 등)를 사용할 수 없습니다.`,
  resumeUnsupported: (p) => `${p.name}은(는) 세션 재개를 지원하지 않습니다`,
  onlyAlwaysAllow: (p) =>
    `${p.name}이(가) 이번에는 “항상 허용”만 제시했습니다. BaoCut은 이를 대신 설정에 기록하지 않으므로 요청을 거부했습니다.`,
  modeSwitchFailed: (p) => `${p.name}이(가) 세션 모드(${p.mode})를 전환하지 못했습니다: ${p.error}`,
  noAllowAllSwitch: (p) =>
    `이 ${p.name} 세션에는 “모두 허용” 스위치(${p.configId})가 없어, 전체 접근에서도 동작마다 확인을 요청합니다.`,
  setOptionFailed: (p) => `${p.name}에서 ${p.configId}=${p.value} 설정에 실패했습니다: ${p.error}`,
  stillAskThisTurn: (p) => `${p.failure}. 이번 턴에는 여전히 동작마다 확인을 요청합니다.`,
  noMatchingMode: (p) =>
    `${p.name}에는 이 접근 모드에 맞는 세션 모드가 없어 자체 기본값으로 실행합니다. 승인이 필요한 동작은 BaoCut이 여전히 접근 모드에 따라 확인합니다.`,
  modelSwitchUnsupported: (p) => `${p.name}은(는) 세션 중에 모델을 바꿀 수 없어 현재 모델을 계속 사용합니다.`,
};
