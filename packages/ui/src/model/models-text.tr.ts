import type { ModelsTextMessages } from './models-text.ts';

export const tr: ModelsTextMessages = {
effort: { minimal: 'En az', low: 'Düşük', medium: 'Orta', high: 'Yüksek' }, auto: 'Otomatik', context: (tokens) => `Bağlam ${tokens}`, maxOutput: (tokens) => `En fazla çıktı ${tokens}`, efforts: (labels) => `Akıl yürütme düzeyi ${labels.join(' / ')}`, noEffort: 'Akıl yürütme düzeyi ayarlanamaz',
};
