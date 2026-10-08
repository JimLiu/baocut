import type { ServicesApiMessages } from './services-api-copy.ts';

export const ko: ServicesApiMessages = {
  capabilities: {
    transcribe: '전사',
    synthesizeSpeech: '음성 합성',
    generateImage: '이미지 생성',
    generateText: '텍스트 생성',
  },
  endpoints: {
    models: '모델 목록',
    model: '모델 조회',
    info: '서비스 정보와 인터페이스 버전',
    transcriptions: '오디오 전사',
    speech: '음성 합성',
    images: '이미지 생성',
    chat: '텍스트 생성(채팅)',
  },
  routing: {
    online: { label: '온라인 서비스', desc: '연결된 클라우드 서비스로 요청을 전달합니다(비용이 들 수 있으며 데이터가 이 컴퓨터 밖으로 나갑니다)' },
    nodes: { label: 'LAN 노드', desc: '페어링된 다른 컴퓨터로 요청을 전달합니다' },
    agent: { label: 'Agent', desc: '이 컴퓨터에 로그인된 Agent(예: Codex)로 요청을 전달합니다' },
  },
  modelsAvailable: (n) => `사용 가능한 모델 ${n}개`,
  notRouted: '모델은 있지만 해당 유형의 라우팅이 꺼져 있어 지금은 요청에 503이 반환됩니다',
  noModels: '아직 사용할 수 있는 모델이 없어 지금은 요청에 503이 반환됩니다',
  defaultModel: '기본 모델',
  target: (provider, model) => `${provider} · ${model}`,
  aliasProviderMissing: '이 공급자를 찾을 수 없어 요청에 404가 반환됩니다',
  aliasNotRouted: '이 유형의 라우팅이 꺼져 있어 요청에 404가 반환됩니다',
  aliasProviderUnavailable: '지금은 이 공급자를 사용할 수 없습니다',
  aliasModelUnavailable: '지금은 이 모델을 사용할 수 없습니다',
  targetNotRouted: '라우팅 꺼짐',
  targetUnavailable: '지금 사용할 수 없음',
  aliasNameEmpty: '이름을 입력하세요(예: whisper-1)',
  aliasNameSlash: '이름에 “/”를 쓸 수 없습니다: <provider>/<model>이 정식 형식이며, 별칭이 이와 겹치면 안 됩니다',
  aliasNameChars: '문자, 숫자, . _ : -만 쓸 수 있으며 문자나 숫자로 시작해야 합니다',
  aliasNameTaken: (name) => `“${name}” 이름이 이미 있습니다. 대상을 바꾸려면 먼저 그 행을 삭제하세요`,
};
