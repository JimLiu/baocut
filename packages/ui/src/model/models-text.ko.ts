import type { ModelsTextMessages } from './models-text.ts';

export const ko: ModelsTextMessages = {
  effort: { minimal: '최소', low: '낮음', medium: '중간', high: '높음' },
  auto: '자동',
  context: (tokens) => `컨텍스트 ${tokens}`,
  maxOutput: (tokens) => `최대 출력 ${tokens}`,
  efforts: (labels) => `추론 강도 ${labels.join(' / ')}`,
  noEffort: '추론 강도를 조정할 수 없음',
};
