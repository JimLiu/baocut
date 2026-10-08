import type { TextEffort } from '@baocut/protocol';
import type { ModelsTextMessages } from './models-text.ts';

export const fr: ModelsTextMessages = {

  effort: { minimal: "Minimal", low: "Faible", medium: "Moyen", high: "Élevé" } as Record<TextEffort, string>,

  auto: "Automatique",
  context: (tokens: string) => `Contexte ${tokens}`,
  maxOutput: (tokens: string) => `Sortie maximum ${tokens}`,
  efforts: (labels: readonly string[]) => `Effort de raisonnement ${labels.join(" / ")}`,
  noEffort: "Effort de raisonnement non réglable",
};
