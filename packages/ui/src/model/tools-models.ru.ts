import type { ToolsModelsMessages } from './tools-models.ts';

export const ru: ToolsModelsMessages = {
  notConnected: "Не подключено",
  unavailable: "Недоступно",
  notDownloaded: "Не скачано",
  unsupported: "Недоступно на этой платформе или в этой сборке",
  auto: "Авто",
  anyLanguage: "Много языков",
  languages: (named) => named.join(", "),
  languagesMore: (first, total) => `${first.join(", ")} и ещё ${total - first.length} `,
};
