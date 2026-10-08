import type { ModelsCloudMessages } from './models-cloud.ts';

export const ptBR: ModelsCloudMessages = {
  capabilityShort: {
    transcribe: "Reconhecimento de fala",
    synthesizeSpeech: "Síntese de fala",
    generateImage: "Geração de imagens",
    generateText: "Geração de texto",
  },
  noModels: "Nenhum modelo declarado",
  unavailableItem: (label, unavailable) => `${label} (${unavailable})`,
};
