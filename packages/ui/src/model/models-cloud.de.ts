import type { OnlineCapability } from '@baocut/protocol';
import type { ModelsCloudMessages } from './models-cloud.ts';

export const de: ModelsCloudMessages = {

  capabilityShort: {
    transcribe: "Spracherkennung",
    synthesizeSpeech: "Sprachsynthese",
    generateImage: "Bilderzeugung",
    generateText: "Texterzeugung",
  } as Record<OnlineCapability, string>,

  noModels: "Keine Modelle deklariert",

  unavailableItem: (label: string, unavailable: string) => `${label} (${unavailable})`,
};
