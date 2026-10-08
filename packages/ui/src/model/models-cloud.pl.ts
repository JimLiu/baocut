import type { ModelsCloudMessages } from './models-cloud.ts';

export const pl: ModelsCloudMessages = {
  capabilityShort: {
    transcribe: 'Rozpoznawanie mowy',
    synthesizeSpeech: 'Synteza mowy',
    generateImage: 'Generowanie obrazów',
    generateText: 'Generowanie tekstu',
  },
  noModels: 'Nie zadeklarowano modeli',
  unavailableItem: (label, unavailable) => `${label} (${unavailable})`,
};
