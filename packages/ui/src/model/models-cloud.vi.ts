import type { ModelsCloudMessages } from './models-cloud.ts';

export const vi: ModelsCloudMessages = {
capabilityShort: { transcribe: 'Nhận dạng giọng nói', synthesizeSpeech: 'Tổng hợp giọng nói', generateImage: 'Tạo hình ảnh', generateText: 'Tạo văn bản' }, noModels: 'Chưa khai báo mô hình', unavailableItem: (label, unavailable) => `${label} (${unavailable})`,
};
