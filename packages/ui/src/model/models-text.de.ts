import type { TextEffort } from "@baocut/protocol";
import type { ModelsTextMessages } from './models-text.ts';

export const de: ModelsTextMessages = {

  effort: { minimal: "Minimal", low: "Niedrig", medium: "Mittel", high: "Hoch" } as Record<TextEffort, string>,

  auto: "Automatisch",
  context: (tokens: string) => `Kontext ${tokens}`,
  maxOutput: (tokens: string) => `Maximale Ausgabe ${tokens}`,
  efforts: (labels: readonly string[]) => `Denkaufwand ${labels.join(" / ")}`,
  noEffort: "Denkaufwand nicht einstellbar",
};
