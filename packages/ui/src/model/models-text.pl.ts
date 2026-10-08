import type { ModelsTextMessages } from './models-text.ts';

export const pl: ModelsTextMessages = {
  effort: { minimal: 'Minimalny', low: 'Niski', medium: 'Średni', high: 'Wysoki' },
  auto: 'Automatyczny',
  context: (tokens) => `Kontekst ${tokens}`,
  maxOutput: (tokens) => `Maksymalny wynik ${tokens}`,
  efforts: (labels) => `Intensywność rozumowania ${labels.join(' / ')}`,
  noEffort: 'Nie można zmienić intensywności rozumowania',
};
