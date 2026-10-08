import type { ModelsCloudMessages } from './models-cloud.ts';

export const ru: ModelsCloudMessages = {
  capabilityShort: {
    transcribe: 'Распознавание речи',
    synthesizeSpeech: 'Синтез речи',
    generateImage: 'Генерация изображений',
    generateText: 'Генерация текста',
  },
  noModels: 'Модели не объявлены',
  unavailableItem: (label, unavailable) => `${label} (${unavailable})`,
};
