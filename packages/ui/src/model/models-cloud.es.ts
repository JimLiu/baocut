import type { ModelsCloudMessages } from './models-cloud.ts';
export const es: ModelsCloudMessages = {
 capabilityShort: { transcribe: 'Reconocimiento de voz', synthesizeSpeech: 'Síntesis de voz', generateImage: 'Generación de imágenes', generateText: 'Generación de texto' },
 noModels: 'No hay modelos declarados', unavailableItem: (label, unavailable) => `${label} (${unavailable})`,
};
