import type { ModelsCloudMessages } from './models-cloud.ts';

export const zhHans: ModelsCloudMessages = {
  capabilityShort: {
    transcribe: '语音识别',
    synthesizeSpeech: '语音合成',
    generateImage: '图像生成',
    generateText: '文本生成',
  },
  noModels: '没有声明模型',
  unavailableItem: (label, unavailable) => `${label}（${unavailable}）`,
};
