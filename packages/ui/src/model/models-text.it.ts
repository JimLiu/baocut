import type { ModelsTextMessages } from './models-text.ts';

export const it: ModelsTextMessages = {
  effort: { minimal: "Minimo", low: "Basso", medium: "Medio", high: "Alto" },
  auto: "Automatico",
  context: (tokens) => `Contesto ${tokens}`,
  maxOutput: (tokens) => `Output massimo ${tokens}`,
  efforts: (labels) => `Intensità di ragionamento ${labels.join(" / ")}`,
  noEffort: "L’intensità di ragionamento non può essere regolata",
};
