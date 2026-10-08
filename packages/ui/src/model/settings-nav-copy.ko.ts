import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const ko: SettingsNavMessages = {
  category: {
    asr: { label: '음성 인식', description: '음성을 전사본과 자막으로 바꾸고 화자를 구분합니다.' },
    tts: { label: '음성 합성', description: '음성을 생성하고, 목소리를 복제하고, 영상에 더빙합니다.' },
    llm: { label: '텍스트 생성', description: '전사본을 다듬고, 자막을 번역하고, 텍스트를 생성합니다.' },
    image: { label: '이미지 생성', description: '영상에 필요한 이미지와 커버를 생성합니다.' },
    sep: { label: '음원 분리', description: '보컬, 반주, 배경음을 분리합니다.' },
    vision: { label: '화면 이해', description: '인물, 화자, 화면 내용을 인식해 스마트 자르기를 돕습니다.' },
  },
  page: { local: '로컬 모델', cloud: '클라우드 모델', voices: '내 목소리' },
  onlyPage: {
    local: '이 분류에는 이 컴퓨터에서 실행되는 로컬 모델만 있으며, 아직 클라우드 모델은 없습니다.',
    cloud: '텍스트 생성에는 클라우드 모델만 있습니다. 코딩 Agent는 “Agent”에서 설정합니다.',
  },
  section: {
    general: '일반',
    shortcuts: '단축키',
    fonts: '글꼴',
    agent: 'Agent 공급자',
    skills: 'Skills',
    glossary: '용어집',
    privacy: '개인 정보 보호 및 권한',
    diagnostics: '진단',
    about: '정보',
  },
  group: { preferences: '환경설정', agents: 'Agent', app: '앱' },
};
