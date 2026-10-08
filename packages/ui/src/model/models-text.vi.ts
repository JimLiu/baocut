import type { ModelsTextMessages } from './models-text.ts';

export const vi: ModelsTextMessages = {
effort: { minimal: 'Tối thiểu', low: 'Thấp', medium: 'Trung bình', high: 'Cao' }, auto: 'Tự động', context: (tokens) => `Ngữ cảnh ${tokens}`, maxOutput: (tokens) => `Đầu ra tối đa ${tokens}`, efforts: (labels) => `Mức suy luận ${labels.join(' / ')}`, noEffort: 'Không thể điều chỉnh mức suy luận',
};
