import type { ModelsTextMessages } from './models-text.ts';

export const zhHant: ModelsTextMessages = {
  effort: { minimal: '最低', low: '低', medium: '中', high: '高' },
  auto: '自動',
  context: (tokens) => `上下文 ${tokens}`,
  maxOutput: (tokens) => `最大輸出 ${tokens}`,
  efforts: (labels) => `推理強度 ${labels.join(' / ')}`,
  noEffort: '無法調整推理強度',
};
