import type { ModelsTextMessages } from './models-text.ts';

export const ptBR: ModelsTextMessages = {
  effort: { minimal: "Mínimo", low: "Baixo", medium: "Médio", high: "Alto" },
  auto: "Automático",
  context: (tokens) => `Contexto ${tokens}`,
  maxOutput: (tokens) => `Saída máxima ${tokens}`,
  efforts: (labels) => `Esforço de raciocínio ${labels.join(" / ")}`,
  noEffort: "O esforço de raciocínio não pode ser ajustado",
};
