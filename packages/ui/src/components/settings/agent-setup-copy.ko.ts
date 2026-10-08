import type { AgentSetupMessages } from './agent-setup-copy.ts';

export const ko: AgentSetupMessages = {
  badge: {
    'not-installed': '설치 안 됨',
    error: '실행할 수 없음',
    outdated: '버전이 오래됨',
    'signed-out': '로그인 필요',
    disabled: '비활성화됨',
  },
  badgeNotChecked: '아직 확인 안 함',
  badgeReady: '사용 가능',
  badgeModelUpgrade: '사용 가능 · 기본 모델에 업그레이드 필요',
  badgeModelUnavailable: '사용 가능 · 기본 모델을 사용할 수 없음',
  badgeUpdate: '사용 가능 · 업데이트 있음',

  errorTitle: (name: string) => `${name}을(를) 찾았지만 실행할 수 없습니다`,
  errorBody: (detail: string | null) =>
    `${detail ? `${detail} ` : ''}보통 Node.js를 설치 제거했거나 업그레이드했을 때, 또는 파일 권한이 바뀌었을 때 발생합니다. 점검을 실행하면 어느 단계에서 실패하는지 찾을 수 있습니다.`,
  errorCta: '점검 실행',
  outdatedTitle: (name: string, version: string | null) =>
    version ? `${name} ${version} 버전은 너무 오래되어 BaoCut에서 사용할 수 없습니다` : `${name}의 이 버전은 너무 오래되어 BaoCut에서 사용할 수 없습니다`,
  outdatedBody: (detail: string | null, minVersion: string) =>
    `${detail ? `${detail} ` : `${minVersion} 이상이 필요합니다. `}업그레이드하면 이 명령줄 도구만 업데이트되며, 계정과 도구 자체 설정은 그대로 유지됩니다.`,
  outdatedCta: (version: string) => `${version} 버전으로 업그레이드`,
  signedOutTitle: (name: string) => `${name}에 다시 로그인해야 합니다`,
  signedOutBody: (name: string) =>
    `로그인은 ${name} 자체 창에서 이루어지며 BaoCut은 계정이나 비밀번호를 다루지 않습니다. 로그인한 뒤 여기로 돌아와 확인하세요.`,
  signedOutCta: '터미널을 열어 로그인',

  stepSkipped: '이전 단계를 통과하면 확인합니다',
  stepFind: '이 컴퓨터에서 찾음',
  stepFindFail: (command: string) => `일반적인 설치 위치와 PATH에서 ${command} 명령을 찾을 수 없습니다`,
  stepRun: '시작 가능',
  stepRunOk: (command: string, version: string) => `${command} --version 실행 결과: ${version}`,
  stepRunFail: '시작하지 못했습니다',
  stepVersion: 'BaoCut이 지원하는 버전',
  stepVersionOk: (version: string, min: string) => `${version}, 최소 ${min}`,
  stepVersionFail: (version: string, min: string) => `현재 ${version}, 최소 ${min}`,
  stepLogin: '계정에 로그인됨',
  stepLoginOk: '로그인됨',
  stepLoginFail: '로그인하지 않았거나 로그인이 만료되었다고 보고합니다',
  stepModels: '모델 목록을 가져올 수 있음',
  stepModelsOk: (n: number) => `모델 ${n}개`,
  stepModelsNone: '모델 목록을 보고하지 않아 세션은 Agent 기본 모델을 사용합니다',
  verdictFail: (label: string, detail: string) => `“${label}” 단계에서 막힘: ${detail}`,
  verdictOk: '다섯 가지 점검을 모두 통과했습니다. 세션을 시작할 수 있습니다.',

  moreSummary: (names: string[], more: boolean) => names.join(', ') + (more ? ' 등' : ''),

  readyTitle: '준비되었습니다',
  readyBody: (name: string, model: string, plan: string) =>
    `새 세션은 ${name} · ${model} 모델을 사용합니다. 이 컴퓨터에 이미 설치된 ${name}과(와) 내 ${plan}(으)로 실행되며 BaoCut은 추가 요금을 받지 않습니다.`,
  readyCta: '세션 시작',
  attentionBody: (name: string) =>
    `이미 이 컴퓨터에 설치되어 있으므로 다시 설치할 필요가 없습니다. 원인과 해결 방법은 아래 “${name}” 행에 있습니다.`,
  attentionCta: '문제 보기',
  offTitle: (name: string) => `${name}이(가) 설치되어 있지만 비활성화되어 있습니다`,
  offBody: '활성화하면 BaoCut에서 한 문장으로 작업을 맡길 수 있습니다.',
  offCta: (name: string) => `${name} 활성화`,
  missingTitle: '이 컴퓨터에서 아직 감지된 Agent가 없습니다',
  missingBodyMany: '아래에서 아무거나 하나를 설치하고 이미 있는 계정으로 로그인하세요. 모두 설치할 필요는 없습니다.',
  missingBodyOne: '아래 단계에 따라 설치하고 이미 있는 계정으로 로그인하세요.',

  logDropped: (n: number) => `…(앞의 ${n}줄 생략)`,
  doneNotDetected: (name: string) =>
    `명령이 끝났지만 아직 ${name}이(가) 감지되지 않습니다. 다른 위치에 설치했다면 위치를 직접 지정할 수 있습니다.`,
  doneSignIn: (name: string, version: string) => `${name} ${version} 감지됨 · 한 번 로그인하면 완료됩니다`,
  doneInstalled: (name: string, version: string) => `${name} ${version} 감지됨`,
  doneUpgraded: (name: string, version: string) => `${name} ${version} 버전으로 업그레이드됨 · 모델 목록을 새로 고치는 중`,

  tier: {
    balanced: { label: '추천', description: '전사, 번역, 편집에 충분하며 빠르고 구독 사용량도 덜 듭니다' },
    max: { label: '최고 성능', description: '더 느리고 구독 사용량이 더 많이 듭니다. 필요한 경우는 드뭅니다' },
    fast: { label: '가장 빠름', description: '자막 몇 줄 바꾸기 같은 작은 수정에 적합합니다' },
  },
  agentDefaultModel: 'Agent 기본 모델',
  cliConfigGate: (model: string) => `CLI 설정을 따름 · ${model} 모델에 CLI 업그레이드 필요`,
  cliConfigModel: (model: string) => `CLI 설정을 따름 · ${model}`,
  cliConfig: 'CLI 설정을 따름',
  modelMissing: '현재 모델 목록에 없음. 새 세션은 추천 모델을 사용합니다',
  effort: {
    minimal: '최소',
    low: '낮음',
    medium: '보통',
    high: '높음',
    xhigh: '매우 높음',
    max: '최대',
  },
  modelDefaultEffort: '모델 기본값',
  modelDefaultEffortOf: (label: string) => `모델 기본값(${label})`,

  rulesTitle: (n: number) => `항상 허용하는 명령 · ${n}개`,
  rulesBody:
    '이 규칙은 세션에서 “항상 허용”을 선택해 만들어진 것입니다. 제거하면 해당 규칙으로 작업이 자동 승인되지 않으며, 접근 모드와 다른 규칙은 계속 적용됩니다.',
  rulesEmpty: '아직 저장된 규칙이 없습니다. 세션의 승인 카드에서 “항상 허용”을 선택하면 여기에 표시됩니다.',
};
