import type { ModelsTextMessages } from './models-text.ts';

export const ru: ModelsTextMessages = {
  effort: { minimal: 'Минимальная', low: 'Низкая', medium: 'Средняя', high: 'Высокая' },
  auto: 'Авто',
  context: (tokens) => `Контекст ${tokens}`,
  maxOutput: (tokens) => `Максимальный вывод ${tokens}`,
  efforts: (labels) => `Уровень рассуждений ${labels.join(' / ')}`,
  noEffort: 'Уровень рассуждений нельзя изменить',
};
