import type { ToolsModelsMessages } from './tools-models.ts';

export const nl: ToolsModelsMessages = {
  notConnected: "Niet verbonden",
  unavailable: "Niet beschikbaar",
  notDownloaded: "Niet gedownload",
  unsupported: "Niet beschikbaar op dit platform of in deze build",
  auto: "Automatisch",
  anyLanguage: "Veel talen",
  languages: (named: readonly string[]) => named.join(", "),
  languagesMore: (first: readonly string[], total: number) => `${first.join(", ")} en ${total - first.length} meer`,
};
