import type { ModelsCloudMessages } from './models-cloud.ts';

export const it: ModelsCloudMessages = {
  capabilityShort: {
    transcribe: "Riconoscimento vocale",
    synthesizeSpeech: "Sintesi vocale",
    generateImage: "Generazione di immagini",
    generateText: "Generazione di testo",
  },
  noModels: "Nessun modello dichiarato",
  unavailableItem: (label, unavailable) => `${label} (${unavailable})`,
};
