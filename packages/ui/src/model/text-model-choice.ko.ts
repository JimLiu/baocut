import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const ko: TextModelChoiceMessages = {
  placeholder: '텍스트 모델 선택',
  providers: '공급자',
  agentReady: (provider) => `Agent · ${provider} 구독 사용 · API보다 느림`,
  agentNote: (note) => `Agent · ${note}`,
  connected: (n) => `연결됨 · 모델 ${n}개`,
  notConnected: '연결 안 됨 · 설정에서 연결',
  settings: '텍스트 모델 관리…',
  settingsSub: 'API 공급자 연결 · 기본 모델',
};
