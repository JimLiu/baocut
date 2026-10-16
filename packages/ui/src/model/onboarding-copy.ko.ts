import type { OnboardingMessages } from './onboarding-copy.ts';

export const ko: OnboardingMessages = {
  dialogLabel: 'BaoCut에 오신 것을 환영합니다',
  stepsLabel: '설정 단계',
  step: {
    agent: 'Agent 연결',
    asr: '음성 인식',
    tts: '음성 합성',
    semantic: '의미 검색',
    image: '이미지 생성',
    music: '음악 생성',
  },
  title: {
    agent: 'BaoCut에 오신 것을 환영합니다',
    asr: '음성 인식 모델 다운로드',
    tts: '음성 합성 모델 다운로드',
    semantic: '의미 검색 설치',
    image: '이미지 생성 모델 다운로드',
    music: '음악 생성 모델 다운로드',
  },
  lead: {
    agent: '만들고 싶은 영상을 말하면 Agent가 전사, 자막 추가, 번역, 더빙, 편집을 대신 해 줍니다. BaoCut은 이 컴퓨터에 있는 Agent(Claude Code, Codex 등)를 본인 계정으로 사용하므로 추가 비용이 없습니다.',
    asr: '전사, 자막 추가, 토킹헤드 영상 다듬기는 모두 말을 텍스트로 바꾸는 데서 시작합니다. 모델은 이 컴퓨터에서 실행되며 오프라인에서도 작동합니다.',
    tts: '음성 합성 모델은 텍스트를 읽어 주고, 녹음으로 목소리를 복제하고, 번역한 영상을 더빙합니다. 우선 한두 개를 골라 시작하고, 나머지는 나중에 설정 › 음성 합성에서 다운로드하세요.',
    semantic: '말한 내용과 화면을 의미로 찾습니다. Space 검색, 주제로 소재 고르기, 화면 맞추기, 번역 메모리가 이 기능을 사용합니다. 설치하면 기존 영상의 색인이 백그라운드에서 만들어집니다.',
    image: '이 컴퓨터에서 한 문장으로 이미지를 생성해 커버와 삽화로 쓸 수 있습니다. 모델이 크고 생성도 느립니다.',
    music: '이 컴퓨터에서 스타일이나 가사로 배경음악과 노래를 생성하고, 영상의 음악 트랙에 바로 추가할 수 있습니다. 생성이 느려서 30초 분량에 몇 분 정도 걸립니다.',
  },
  where: {
    tts: {
      title: '도구 › 음성 생성에서 사용',
      body: '텍스트를 쓰거나 Space의 문서나 자막을 고른 다음 모델과 목소리를 선택하세요. 다운로드하지 않은 모델도 그곳에서 다운로드할 수 있습니다.',
    },
    image: { title: '도구 › 이미지 생성에서 사용', body: '그림을 한 문장으로 설명하세요. Agent도 커버를 만들 때 이 기능을 사용합니다.' },
    music: {
      title: '도구 › 음악 생성에서 사용',
      body: '스타일을 고르고 가사를 쓰세요. 음악은 Space에 저장되며 영상에 추가할 수 있습니다.',
    },
  },
  diarizes: '전사하면서 화자 구분',
  needsDiarization: (pack) => `화자를 구분하려면 “${pack}”도 다운로드하세요`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '기본 목소리 9종 · 말투를 한 문장으로 지정',
    'qwen3-tts-0.6b-base': '3초 녹음으로 목소리 복제',
    voxcpm2: '녹음으로 목소리 복제 · 스타일 지정 · 30개 언어와 광둥어',
    'qwen-image-2.1-turbo': '증류 버전 · 8단계 고정 · 기본 모델보다 2배 이상 빠름',
    'qwen-image-2.1': '기본 모델 · 단계가 많아 더 느림',
    'yue2-3b': '스타일이나 가사로 생성 · 30초 분량에 몇 분 정도',
  },
  recommended: '추천',
  installed: '설치됨',
  missingParts: '구성 요소 누락',
  planLine: (parts) => `함께 다운로드: ${parts}`,
  downloading: (name) => `${name} 다운로드 중`,
  inBackground: '백그라운드에서 다운로드 중',
  bgNote: '다운로드 전에 출처와 저장 위치를 보여 드립니다. 확인한 뒤에만 시작되고 백그라운드에서 진행되므로 기다릴 필요가 없습니다.',
  asrAlt: '다운로드하고 싶지 않다면 나중에 설정 › API 공급자에서 클라우드 음성 인식을 추가할 수도 있습니다.',
  unsupported: '이 컴퓨터에서는 이 모델들을 실행할 수 없습니다. 이 단계는 건너뛰어도 됩니다.',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: '이 컴퓨터의 Agent',
  agentChecking: '이 컴퓨터의 Agent 확인 중…',
  agentMissingBody: '원하는 항목을 선택하면 BaoCut이 백그라운드에서 설치합니다. 설치가 끝나면 기존 계정으로 한 번 로그인하세요.',
  agentNote: '선택한 Agent는 새 세션의 Agent 메뉴에 나타납니다. 설치는 백그라운드에서 진행되므로 기다릴 필요가 없습니다. 기본값을 고르거나 더 추가하려면 설정 › Agent 공급자로 이동하세요.',
  agentInstalled: '이 컴퓨터에 설치됨',
  agentFix: (problem) => `${problem} · 설정 › Agent 공급자에서 해결`,
  agentManual: '공식 안내에 따라 터미널에서 설치 · 설정 › Agent 공급자 참고',
  agentNotInstalled: (plan) => (plan ? `설치 안 됨 · 설치 후 이미 있는 ${plan}(으)로 로그인` : '설치 안 됨'),
  agentWillInstall: (method, command, login) => `${method}(으)로 백그라운드에서 설치(${command}) · 이후 터미널에서 ${login} 명령으로 로그인`,
  agentInstalling: (method, login) => `${method}(으)로 백그라운드에서 설치 중 · 이후 터미널에서 ${login} 명령으로 로그인`,
  agentInstallingLabel: (name) => `${name} 설치 중`,
  agentInstallFailed: '설치하지 못했습니다 · 자세한 내용은 백그라운드 작업에 있습니다',

  next: '다음',
  finish: '완료',
  skip: '건너뛰기',
  exit: '설정 종료',
  install: (n) => `백그라운드에서 ${n}개 설치 후 계속`,
  download: (size, last) => `백그라운드에서${size ? ` ${size}` : ''} 다운로드 후 ${last ? '완료' : '계속'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return `${name} ${kind === 'install' ? '설치 중' : kind === 'download' ? '다운로드 중' : '준비 중'}${tail}`;
    },
    many: (kind, n) => `백그라운드에서 ${n}개 ${kind === 'install' ? '설치 중' : kind === 'download' ? '다운로드 중' : '준비 중'}`,
    idle: (kind) => `백그라운드 ${kind === 'install' ? '설치' : kind === 'download' ? '다운로드' : '다운로드 및 설치'}`,
    done: (kind, n) => `${n}개 ${kind === 'install' ? '설치됨' : kind === 'download' ? '다운로드됨' : '완료'}`,
    failed: (kind, n) => `${n}개 ${kind === 'install' ? '설치 안 됨' : kind === 'download' ? '다운로드 안 됨' : '완료 안 됨'}`,
  },
  closedToast: (models, agents) => {
    const parts = [...(models ? [`모델 ${models}개 다운로드`] : []), ...(agents ? [`Agent ${agents}개 설치`] : [])];
    return `백그라운드에서 ${parts.join(', ')}가 진행 중입니다. 끝나면 바로 사용할 수 있습니다.`;
  },
  viewTasks: '백그라운드 작업 보기',
};
