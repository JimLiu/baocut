import type { VoicePickerMessages } from './voice-picker.ts';

export const ko: VoicePickerMessages = {
  clonedOn: (provider) => `${provider}에 복제됨 · 이 복제로 합성`,
  defaultVoice: '기본 목소리',
  providerPreset: (provider, name) => `${provider}의 ${name}`,
  loadingMine: '내 목소리 불러오는 중…',
  cloneNew: '새 목소리 복제…',
  cloneNewHint: '설정 › 모델 › 음성 합성 › 내 목소리에서 녹음하거나 파일에서 가져오세요',
  myVoices: '내 목소리',
  providerVoices: (provider) => `${provider} 목소리`,
  customVoice: '목소리 ID 입력…',
  customVoiceHint: '공급자 계정의 목소리 ID',
  tempReference: '녹음 한 번만 사용…',
  tempReferenceHint: '이 버전의 합성 API는 아직 일회성 참조 녹음을 받지 않습니다 · 내 목소리에 저장하고 먼저 복제하세요',
  other: '기타',
  voiceDeleted: '이 목소리는 삭제되었습니다 · 다른 목소리를 선택하거나 기본값으로 돌아가세요',
  customLine: '공급자에게 그대로 전달해 확인하게 합니다. 내 목소리에서 복제 목소리를 만들어 선택할 수도 있습니다',
  presetLine: (provider, voiceId) => (voiceId === null ? `${provider} 목소리` : `${provider} 목소리 · ${voiceId}`),
  defaultLine: (provider, name) => `선택하지 않으면 ${provider}의 기본 목소리(${name})를 사용합니다`,
  noDefault: '이 모델에는 기본 목소리가 없습니다. 먼저 하나를 선택하세요',
};
