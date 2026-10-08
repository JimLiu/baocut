import type { DriversCodexMessages } from './drivers-codex.ts';

export const ko: DriversCodexMessages = {
  plan: 'ChatGPT Plus 또는 Pro 구독',
  installHint: 'Codex CLI를 설치하세요',
  signedOut: (p) => `Codex에 로그인되어 있지 않습니다. 터미널에서 codex login을 실행하세요.${p.detail ? ` (${p.detail})` : ''}`,
  chatgptAccount: 'ChatGPT 계정',
  apiKey: 'OpenAI API 키',
  accessToken: '액세스 토큰',
  workloadIdentity: '워크로드 ID',
  codexAccount: 'Codex 계정',
  steerMismatch: (p) => `Codex가 turn/steer에 예상과 다른 응답을 보냈습니다: 예상 턴 ${p.expected}, 받은 값 ${p.received}`,
  appServerExited: (p) => `codex app-server가 종료되었습니다(코드 ${p.code}, 시그널 ${p.signal})${p.stderr ? `\n${p.stderr}` : ''}`,
  connectionClosed: 'codex app-server 연결이 닫혔습니다',
  requestTimeout: (p) => `codex app-server 요청 시간이 초과되었습니다: ${p.method}`,
  appServerGone: 'codex app-server가 종료되었습니다',
};
