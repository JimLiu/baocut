import type { TtsLocalMessages } from './models-tts-local-copy.ts';

const LANG_SHORT: Record<string, string> = {
  zh: '중국어',
  en: '영어',
  ja: '일본어',
  ko: '한국어',
  de: '독일어',
  fr: '프랑스어',
  es: '스페인어',
  it: '이탈리아어',
  pt: '포르투갈어',
  ru: '러시아어',
  ar: '아랍어',
};

export const ko: TtsLocalMessages = {
  languageShort: (code) => LANG_SHORT[code] ?? code,
  languagesAny: '모든 언어',
  languagesMore: (shown, total) => `${shown.join(' / ')} 등 ${total}개 언어`,
  summaryCloneDescribe: (builtins, byDuration) =>
    `내장 목소리 ${builtins}개, 녹음으로 목소리 복제, 성별·나이·음높이를 골라 새 목소리 만들기${byDuration ? ' · 목표 길이에 맞춰 읽기 가능' : ''}`,
  summaryClone: (builtins, style) => `내장 목소리 ${builtins}개 또는 녹음으로 목소리 복제${style ? ' · 한 줄 프롬프트로 스타일 지정 가능' : ''}`,
  summaryDescribe: (builtins) =>
    builtins
      ? `원하는 목소리를 한 문장으로 설명하면 모델이 새로 만들어 줌 · 내장 목소리 ${builtins}개도 바로 사용 가능`
      : '원하는 목소리를 한 문장으로 설명하면 모델이 새로 만들어 줌',
  summaryPreset: (speakers, style) => `프리셋 목소리 ${speakers}개 · 하나를 고르면 바로 읽음${style ? ' · 한 줄 프롬프트로 어조 지정 가능' : ''}`,
  modeCloneDescribe: '내장 목소리 / 복제 / 설명',
  modeClone: '내장 목소리 / 복제',
  modeDescribe: '설명으로 목소리 만들기',
  modePreset: '프리셋 목소리',
  factStyle: '스타일 프롬프트',
  factSlow: '느림',
  nonCommercialChip: '비상업적 용도 전용',
  licenseCommercial: (name) => `${name} · 상업적 사용 가능`,
  licenseNonCommercial: (name, owner) => `${name} · 비상업적 용도로만 사용 가능 · 상업적으로 사용하려면 ${owner}에 별도로 신청하세요`,
  familyDesc: {
    'qwen3-tts':
      'Qwen3-TTS: CustomVoice에는 프리셋 화자 9명이 있고 한 줄 프롬프트로 어조를 지정할 수 있습니다. Base는 참조 녹음으로 복제합니다. 1.7B VoiceDesign은 설명만으로 새 목소리를 만듭니다. 1.7B는 음질이 더 좋지만 더 느립니다.',
    indextts2:
      'IndexTTS: 내장 목소리 8개를 쓰거나 내 녹음으로 복제할 수 있습니다. 녹음의 음색만 가져오며 녹음의 전사본은 읽지 않습니다. IndexTTS 2.5는 말하기 속도도 조절할 수 있습니다.',
    'gpt-sovits':
      'GPT-SoVITS: 내장 목소리 8개를 쓰거나 내 녹음으로 복제할 수 있습니다. 참조 녹음의 전사본도 함께 주면 더 비슷해지며, 이때 참조 녹음은 3–10초여야 합니다.',
    voxcpm2:
      'VoxCPM2: 내장 목소리 8개를 쓰거나 내 녹음으로 복제할 수 있습니다. 녹음의 전사본을 함께 주면 가장 비슷하며, 한 줄 프롬프트로 말투를 지정할 수 있습니다. 48 kHz로 출력합니다.',
    omnivoice:
      'OmniVoice: 내장 목소리 8개를 쓰거나, 내 녹음으로 복제하거나, 단어 목록에서 성별·나이·음높이를 골라 새 목소리를 만들 수 있습니다. 지원하는 언어가 가장 많습니다. 비상업적 용도 전용입니다.',
  },
  quickDescribe: '목소리는 전적으로 이 설명으로 정해집니다. 설명을 바꾸면 다른 사람의 목소리가 됩니다',
  quickVoxcpm: '거의 실시간: 한 문장을 읽는 시간만큼 생성에 걸리며, 처음 불러올 때 약 5초가 걸립니다',
  quickNonCommercial: (license) => `비상업적 용도 전용(${license}): 상업적으로 쓸 콘텐츠에는 다른 모델을 쓰세요`,
  quickSlow: '대형 모델: 비슷한 모델보다 합성이 느리고, 처음 불러올 때도 시간이 더 걸립니다',
};
