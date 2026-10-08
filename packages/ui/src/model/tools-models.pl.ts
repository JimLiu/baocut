import type { ToolsModelsMessages } from './tools-models.ts';

export const pl: ToolsModelsMessages = {
  notConnected: "Niepołączony",
  unavailable: "Niedostępne",
  notDownloaded: "Nie pobrano",
  unsupported: "Niedostępne na tej platformie lub w tej kompilacji",
  auto: "Automatyczny",
  anyLanguage: "Wiele języków",
  languages: (named) => named.join(", "),
  languagesMore: (first, total) => `${first.join(", ")} i jeszcze ${total - first.length} `,
};
