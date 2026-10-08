import type { ToolsModelsMessages } from './tools-models.ts';

export const de: ToolsModelsMessages = {
  notConnected: "Nicht verbunden",
  unavailable: "Nicht verfügbar",
  notDownloaded: "Nicht heruntergeladen",
  unsupported: "Auf dieser Plattform oder in diesem Build nicht verfügbar",
  auto: "Automatisch",
  anyLanguage: "Viele Sprachen",
  languages: (named: readonly string[]) => named.join(", "),
  languagesMore: (first: readonly string[], total: number) => `${first.join(", ")} und ${total - first.length} weitere`,
};
