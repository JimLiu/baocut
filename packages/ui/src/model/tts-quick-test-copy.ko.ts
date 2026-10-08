import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const ko: TtsQuickTestMessages = {
  kindIntro: '소개',
  kindNumbers: '숫자',
  kindMood: '어조',

  presetSub: {
    Vivian: '여성 · 밝음',
    Serena: '여성 · 차분함',
    Uncle_Fu: '남성 · 저음',
    Dylan: '남성 · 젊음',
    Eric: '남성 · 방송',
    Ryan: '남성 · 경쾌함',
    Aiden: '남성 · 내레이션',
    Ono_Anna: '여성 · 일본어',
    Sohee: '여성 · 한국어',
  },

  builtinVoice: {
    'zh-female': '중국어 여성',
    'zh-male': '중국어 남성',
    'en-female': '영어 여성',
    'en-male': '영어 남성',
    'ja-female': '일본어 여성',
    'ja-male': '일본어 남성',
    'es-female': '스페인어 여성',
    'es-male': '스페인어 남성',
  },
  builtinCredit: 'FLEURS 코퍼스(CC BY 4.0)와 CMU ARCTIC · 다듬고 음량 정규화함 · 원본 고지 유지',

  describeWarm: '따뜻한 여성',
  describeWarmText: '친구와 대화하듯 적당한 속도로 말하는 따뜻하고 친근한 성인 여성 목소리',
  describeAnchor: '차분한 남성',
  describeAnchorText: '방송 어조에 고른 리듬으로 말하는 차분하고 또렷한 성인 남성 목소리',
  describeBright: '밝은 청소년',
  describeBrightText: '편안한 어조로 말하는 밝고 생기 있는 젊은 목소리',

  toneUpbeat: '경쾌함',
  toneUpbeatText: '평소보다 조금 빠르게, 밝고 경쾌한 에너지로 말하세요',
  toneNatural: '자연스러움',
  toneAnchor: '차분함',
  toneAnchorText: '고른 속도로 차분하고 또렷한 방송 목소리로 말하세요',
  toneSoft: '부드러움',
  toneSoftText: '가까이에서 말하듯 부드럽고 더 천천히 말하세요',

  customDescribe: '직접 설명',
  defaultVoice: '기본 목소리',
  myVoices: '내 목소리',
  fileVoice: '이번만 클립 사용',
  seconds: (n: string) => `${n}초`,

  textRequired: '먼저 합성할 텍스트를 입력하세요',
  textTooLong: (max: number) => `한 번에 최대 ${max}자입니다. 미리 듣기에는 더 짧은 문장을 사용하세요`,
  describeRequired: '먼저 원하는 목소리를 한 문장으로 설명하세요',
  myVoiceGone: '이 목소리는 더 이상 내 목소리에 없습니다. 다른 목소리를 선택하세요',
  referenceRequired: '먼저 참조 녹음을 선택하거나 기본 제공 목소리로 돌아가세요',

  phaseSubmitting: '제출 중',
  phaseQueued: '대기 중',
  phaseLoading: '모델 불러오는 중',
  phaseGeneratingStep: (step: number, total: number) => `오디오 생성 중 · ${step}/${total}단계`,
  phaseGenerating: '오디오 생성 중',
  phaseWriting: '오디오 저장 중',
  phasePreparing: '준비 중',

  sampleVoice: (name: string) => `샘플 · ${name}`,
  customText: '사용자 지정 텍스트',
  elapsed: (seconds: string) => `소요 시간 ${seconds}초`,
  audioLength: (seconds: string) => `오디오 ${seconds}초`,
};
