import type { ModelsCloudMessages } from './models-cloud.ts';

export const zhHant: ModelsCloudMessages = {
  capabilityShort: {
    transcribe: '語音辨識',
    synthesizeSpeech: '語音合成',
    generateImage: '影像生成',
    generateText: '文字生成',
  },
  noModels: '未宣告任何模型',
  unavailableItem: (label, unavailable) => `${label}（${unavailable}）`,
};
