import type { ModelsCloudMessages } from './models-cloud.ts';

export const tr: ModelsCloudMessages = {
capabilityShort: { transcribe: 'Konuşma tanıma', synthesizeSpeech: 'Konuşma sentezi', generateImage: 'Görsel oluşturma', generateText: 'Metin oluşturma' }, noModels: 'Model bildirilmedi', unavailableItem: (label, unavailable) => `${label} (${unavailable})`,
};
