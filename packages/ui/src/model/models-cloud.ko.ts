import type { ModelsCloudMessages } from './models-cloud.ts';

export const ko: ModelsCloudMessages = {
  capabilityShort: {
    transcribe: '음성 인식',
    synthesizeSpeech: '음성 합성',
    generateImage: '이미지 생성',
    generateText: '텍스트 생성',
  },
  noModels: '선언된 모델 없음',
  unavailableItem: (label, unavailable) => `${label}(${unavailable})`,
};
