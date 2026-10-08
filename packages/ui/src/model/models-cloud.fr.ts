import type { OnlineCapability } from '@baocut/protocol';
import type { ModelsCloudMessages } from './models-cloud.ts';

export const fr: ModelsCloudMessages = {

  capabilityShort: {
    transcribe: "Reconnaissance vocale",
    synthesizeSpeech: "Synthèse vocale",
    generateImage: "Génération d’images",
    generateText: "Génération de texte",
  } as Record<OnlineCapability, string>,

  noModels: "Aucun modèle déclaré",

  unavailableItem: (label: string, unavailable: string) => `${label} (${unavailable})`,
};
