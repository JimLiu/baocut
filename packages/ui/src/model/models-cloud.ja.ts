import type { ModelsCloudMessages } from './models-cloud.ts';

export const ja: ModelsCloudMessages = {
  capabilityShort: {
    transcribe: '音声認識',
    synthesizeSpeech: '音声合成',
    generateImage: '画像生成',
    generateText: 'テキスト生成',
  },
  noModels: '宣言されたモデルはありません',
  unavailableItem: (label, unavailable) => `${label}（${unavailable}）`,
};
