import type { ToolsModelsMessages } from './tools-models.ts';

export const tr: ToolsModelsMessages = {
  notConnected: 'Bağlı değil',
  unavailable: 'Kullanılamıyor',
  notDownloaded: 'İndirilmedi',
  unsupported: 'Bu platformda veya derlemede kullanılamıyor',
  auto: 'Otomatik',
  anyLanguage: 'Birçok dil',
  languages: (named) => named.join(', '),
  languagesMore: (first, total) => `${first.join(', ')} ve ${total - first.length} dil daha`,
};
