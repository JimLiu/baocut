import type { ModelsLocalSpeechMessages } from './local-speech.ts';

export const ko: ModelsLocalSpeechMessages = {
  paceQwen06: '실시간보다 약 55배 느려 3초짜리 대사에 2~3분이 걸립니다',
  paceQwen17: '0.6B(실시간보다 약 55배 느림)보다 느릴 것으로 예상되며, 이 모델은 측정하지 않았습니다',
  paceIndexTts2: 'IndexTTS 2.5(실시간보다 120~145배 느림)와 비슷할 것으로 예상되며, 이 모델은 측정하지 않았습니다',
  paceIndexTts25: '실시간보다 120~145배 느려 4~5초짜리 대사에 7~10분이 걸립니다',
  paceGptSovits: '실시간보다 약 6배 느려 4초짜리 대사에 30초 정도 걸립니다',
  paceVoxcpm2: '가장 큰 모델이라 대사마다 몇 분씩 걸릴 것으로 예상되며, 이 모델은 측정하지 않았습니다',
  paceOmnivoice: '실시간보다 약 30배 느려 4초짜리 대사에 2분 정도 걸립니다',
  paceDefault: '대사마다 몇 분씩 걸립니다',
  cpuNote: (p: { pace: string }) =>
    `이 컴퓨터의 CPU에서 코어를 1~2개만 사용해 합성합니다: ${p.pace}. NVIDIA GPU(CUDA)가 있으면 훨씬 빠를 것입니다(측정하지 않음)`,
  oneVoiceSource: 'voice, reference, voiceDescription 중 하나만 지정하세요',
  modeUnsupported: (p: { modelId: string; what: string; mode: string }) =>
    `${p.modelId} 모델은 ${p.what} 기능(${p.mode})을 지원하지 않습니다`,
  modeClone: '참조 녹음으로 복제',
  modeDescribe: '설명으로 목소리 만들기',
  noReferenceTranscript: (p: { modelId: string }) =>
    `${p.modelId} 모델은 참조 녹음의 전사본(reference.transcript)을 읽지 않습니다`,
  descriptionEmpty: '설명은 비워 둘 수 없습니다',
  noPresetVoice: (p: { modelId: string; need: string }) => `${p.modelId} 모델에는 프리셋 목소리가 없습니다. ${p.need} 항목을 지정하세요`,
  noSuchVoice: (p: { modelId: string; voice: string }) => `${p.modelId} 모델에는 ${p.voice} 목소리가 없습니다`,
  noDefaultVoice: (p: { modelId: string }) => `${p.modelId} 모델에는 기본 목소리가 없습니다. voice를 지정하세요`,
  termNotInVocabulary: (p: { modelId: string; term: string }) =>
    `${p.modelId} 모델의 목소리 설명에는 해당 어휘의 단어만 쓸 수 있습니다: “${p.term}” 단어는 어휘에 없습니다`,
  onePerCategory: (p: { modelId: string; category: string }) =>
    `${p.modelId} 모델의 목소리 설명에는 범주마다 용어를 하나만 쓸 수 있습니다(${p.category})`,
  builtinReferenceLabel: '기본 제공 목소리 녹음',
  referenceUnreadable: (p: { name: string }) =>
    `“${p.name}” 참조 녹음을 읽을 수 없습니다: 없거나, 파일이 아니거나, 읽을 수 없는 상태입니다. 다른 녹음을 사용해 보세요`,
};
