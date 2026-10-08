import type { ToolsTextMessages } from './tools-text.ts';

export const nl: ToolsTextMessages = {
  emptyInput: "Voer eerst in wat je wilt genereren",
  tooLong: (max: string) => `Maximaal ${max} tekens tegelijk`,

  sample: "Schrijf een nasynchronisatie van 30 seconden voor een video van een stadswandeling. Houd de toon natuurlijk en benoem de straten, cafés en schemering.",
  counter: (n: string, max: string) => `${n} / ${max} tekens`,
  connectTextModel: "Verbind eerst een tekstmodel",
  connectFirst: (provider: string) => `Verbinden: ${provider}`,
  effortFixed: "Denkintensiteit · niet instelbaar voor dit model",
  effort: (label: string) => `Denkintensiteit · ${label} (standaard ingesteld op de pagina Modellen)`,
  auto: "Automatisch",
  headerChip: (provider: string) => `Online · ${provider} · gefactureerd per token`,

  fileStem: "Gegenereerde tekst",
  chars: (n: string) => `${n} tekens`,
  outputTokens: (n: string) => `${n} uitvoertokens`,
  truncated: "Uitvoerlimiet bereikt; de rest is afgekapt",
};
