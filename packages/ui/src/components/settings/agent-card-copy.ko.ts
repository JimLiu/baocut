import { createElement, Fragment, type ReactNode } from 'react';
import type { AgentCardMessages } from './agent-card-copy.ts';

export const ko: AgentCardMessages = {
  runFailed: (message: string) => `실행하지 못했습니다: ${message}`,
  stopFailed: (message: string) => `중지하지 못했습니다: ${message}`,
  loginCommand: '로그인 명령',
  installCommand: '설치 명령',
  upgradeCommand: '업그레이드 명령',
  linkLabel: '링크',
  terminalLogin: (command: string) => `터미널에서 ${command} 실행 중 · 로그인한 뒤 여기로 돌아오세요`,
  terminalRun: (command: string) => `터미널에서 ${command} 실행 중 · 끝나면 여기로 돌아오세요`,
  terminalCopied: (label: string) => `터미널을 열지 못했습니다. ${label}을(를) 복사했으니 터미널에 붙여넣어 실행하세요.`,
  terminalManual: (command: string) => `터미널을 열지 못했습니다. 터미널에서 ${command} 명령을 실행하세요.`,
  terminalFailed: (message: string) => `터미널을 열지 못했습니다: ${message}`,
  enableFailed: (message: string) => `활성화하지 못했습니다: ${message}`,
  disableFailed: (message: string) => `비활성화하지 못했습니다: ${message}`,
  recheckFailed: (message: string) => `다시 확인하지 못했습니다: ${message}`,
  saveModelFailed: (message: string) => `기본 모델을 저장하지 못했습니다: ${message}`,
  saveEffortFailed: (message: string) => `기본 추론 강도를 저장하지 못했습니다: ${message}`,
  refreshFailed: (message: string) => `모델을 새로 고치지 못했습니다: ${message}`,
  setDefaultFailed: (message: string) => `기본값으로 설정하지 못했습니다: ${message}`,
  openFailed: (message: string) => `열지 못했습니다: ${message}`,
  enabled: (name: string) => `${name}을(를) 활성화했습니다`,
  disabled: (name: string) => `${name}을(를) 비활성화했습니다 · 새 세션 목록에 더 이상 표시되지 않습니다`,

  defaultBadge: '기본',
  subInstalled: (version: string | null, account: string | null) =>
    ['이 컴퓨터에 설치됨', version ? `v${version}` : null, account].filter(Boolean).join(' · '),
  subMissing: (command: string, plan: string) => `이 컴퓨터에서 ${command} 명령을 찾을 수 없음 · 이미 있는 ${plan}(으)로 충분합니다`,
  enable: (name: string) => `${name} 활성화`,
  details: '자세히',
  install: '설치',
  checking: '확인 중…',
  gateTitle: (name: string, model: string) => `${name}에 설정된 기본 모델 ${model}에는 더 새로운 버전이 필요합니다`,
  gateBody: (version: string, model: string) =>
    `이 컴퓨터의 버전은 ${version}이며, 이 버전의 모델 목록에는 ${model} 모델이 없습니다. “Agent 기본 모델”로 설정된 세션은 설정대로 이 모델을 사용하므로 보낼 때 거부됩니다. 특정 모델을 지정한 세션은 영향을 받지 않습니다.`,
  gateUpgrade: '업그레이드하면 이 명령줄 도구만 업데이트되며, 계정과 도구 자체 설정은 그대로 유지됩니다.',
  gateNoUpgrade: '아직 업그레이드할 수 있는 새 버전이 없습니다. 지금은 세션에서 목록에 있는 모델을 선택하세요.',
  upgradeTo: (version: string) => `${version} 버전으로 업그레이드`,
  updateStrip: (latest: string, current: string) =>
    `${latest} 버전을 사용할 수 있습니다(현재: ${current}). 업그레이드하지 않아도 계속 사용할 수 있습니다.`,
  viewUpgrade: '업그레이드 방법 보기',
  cancel: '취소',

  defaultModel: '기본 모델',
  defaultModelDesc:
    '새 세션은 이 모델로 시작하며, 세션마다 입력창 아래에서 바꿀 수 있습니다. 전사, 번역, 편집에는 “추천” 등급이면 충분하며 가장 강력한 모델은 필요하지 않습니다.',
  defaultModelOf: (name: string) => `${name} 기본 모델`,
  defaultEffortOf: (name: string) => `${name} 기본 추론 강도`,
  modelsOf: (name: string, count: number) => `${name} 모델 · ${count}개`,
  modelsList: (list: string) => `${list}. 확인할 때마다 새로 고칩니다.`,
  modelsNone: '모델 목록을 보고하지 않아 세션은 Agent 기본 모델을 사용합니다. 다음 확인 때 다시 요청합니다.',
  refreshing: '새로 고치는 중…',
  refreshModels: '모델 새로 고침',
  refreshed: (name: string) => `${name} 모델 목록을 새로 고쳤습니다`,
  nowDefault: (name: string) => `이제 새 세션은 ${name}을(를) 사용합니다`,
  version: (version: string | null) => (version ? `버전 · v${version}` : '버전'),
  versionDesc: (latest: string | null, min: string | null, source: string) =>
    `${latest ? `${latest} 버전으로 업그레이드할 수 있습니다. ` : ''}${min ? `BaoCut에는 ${min} 이상이 필요합니다. ` : ''}업그레이드하면 이 명령줄 도구만 업데이트되며, 계정과 도구 자체 설정은 그대로 유지됩니다. ${source}`,
  account: '계정',
  accountDesc: (signedOut: boolean, account: string | null, plan: string) =>
    `${signedOut ? '로그인하지 않았거나 로그인이 만료되었습니다' : (account ?? '로그인됨')}. 내 ${plan}을(를) 사용하며 BaoCut은 추가 요금을 받지 않습니다. 로그인은 터미널에서 합니다.`,
  loginInTerminal: '터미널을 열어 로그인',
  switchAccount: '계정 전환…',
  location: '설치 위치',
  locationDesc: 'BaoCut은 이 컴퓨터에 있는 이 프로그램을 직접 호출하며, 따로 설치하지 않습니다.',
  realLocation: '실제 위치',
  setLocation: '위치 직접 지정',
  troubleshoot: '문제 해결',
  troubleshootDesc: '설치, 버전, 로그인, 모델 목록을 하나씩 확인하고 어느 단계에서 막혔는지 알려 줍니다.',
  setDefault: '기본값으로 설정',
  runChecks: '점검 실행',

  sourceKnown: (label: string) =>
    `이 사본은 “${label}” 방식으로 설치되었으므로 같은 방식으로 업그레이드하세요. 다른 방법으로는 이 사본을 업그레이드할 수 없고 사본이 하나 더 설치될 뿐입니다.`,
  sourceUnknown: '설치할 때와 같은 방법으로 업그레이드하세요.',
  scriptInstall:
    '이 명령은 공식 웹사이트에서 스크립트를 다운로드해 실행합니다. BaoCut은 인터넷의 스크립트를 대신 실행하지 않으니 복사해서 터미널에서 직접 실행하세요.',
  scriptUpgrade: '이 명령은 공식 웹사이트에서 스크립트를 다운로드해 실행합니다. 복사해서 터미널에서 직접 실행하세요.',
  copyUpgrade: '이 명령을 복사해 터미널에서 실행한 뒤 여기로 돌아와 다시 확인하세요.',
  runnableHint: '명령 왼쪽의 ▶를 클릭하면 여기서 실행되고 출력이 아래에 표시됩니다. 또는 복사해서 터미널에서 직접 실행하세요.',
  copyHint: '아래 명령을 복사해 터미널에서 실행하세요.',
  installMethod: '설치 방법',
  upgradeMethod: '업그레이드 방법',
  needs: (needs: string) => `이 컴퓨터에 ${needs}이(가) 있어야 합니다.`,

  installIntro: (name: string, plan: string) =>
    `${name}은(는) 내 컴퓨터에 설치하는 명령줄 AI 어시스턴트이며, 이미 있는 ${plan}(으)로 로그인합니다. BaoCut은 이를 호출할 뿐이므로 추가 요금이 없고 BaoCut에 API 키를 입력할 필요도 없습니다.`,
  stepInstall: '이 컴퓨터에 설치',
  stepInstallOfficial: '공식 안내에 따라 이 컴퓨터에 설치',
  installOfficialBody: (command: ReactNode): ReactNode =>
    createElement(Fragment, null, '공식 안내에 따라 설치하세요. 설치가 끝나면 터미널에서 ', command, ' 명령을 실행할 수 있어야 합니다.'),
  stepLogin: '계정에 로그인',
  stepLoginBody:
    '설치한 뒤 터미널에서 아래 명령을 실행하고 안내에 따라 브라우저에서 로그인하세요. 로그인은 해당 프로그램의 창에서 이루어지며 BaoCut은 계정이나 비밀번호를 다루지 않습니다.',
  stepBack: '여기로 돌아오기',
  stepBackBody: '설치와 로그인이 확인되면 바로 사용할 수 있습니다.',
  detecting: '확인 중…',
  recheck: '설치 완료, 다시 확인',
  notDetected: '설치했는데 감지되지 않나요?',
  notDetectedBody:
    'BaoCut은 PATH와 일반적인 설치 위치(Homebrew, npm 전역 폴더, ~/.local/bin)에서 찾습니다. 버전 관리자(nvm, asdf, mise)로 설치한 경우 다른 위치에 있을 수 있으니 BaoCut에 위치를 직접 지정하세요.',
  diagnosisOf: (name: string) => `${name} 점검 결과`,
};
