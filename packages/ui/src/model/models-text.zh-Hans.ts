import type { ModelsTextMessages } from './models-text.ts';

export const zhHans: ModelsTextMessages = {
  effort: { minimal: '最低', low: '低', medium: '中', high: '高' },
  auto: '自动',
  context: (tokens) => `上下文 ${tokens}`,
  maxOutput: (tokens) => `单次输出 ${tokens}`,
  efforts: (labels) => `推理强度 ${labels.join(' / ')}`,
  noEffort: '不能调推理强度',
};
