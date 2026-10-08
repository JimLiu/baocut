import type { ModelsTextMessages } from './models-text.ts';

export const ja: ModelsTextMessages = {
  effort: { minimal: '最小', low: '低', medium: '中', high: '高' },
  auto: '自動',
  context: (tokens) => `コンテキスト ${tokens}`,
  maxOutput: (tokens) => `最大出力 ${tokens}`,
  efforts: (labels) => `推論の強度 ${labels.join(' / ')}`,
  noEffort: '推論の強度は調整できません',
};
