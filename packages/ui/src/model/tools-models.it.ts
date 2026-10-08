import type { ToolsModelsMessages } from './tools-models.ts';

export const it: ToolsModelsMessages = {
  notConnected: 'Non connesso',
  unavailable: 'Non disponibile',
  notDownloaded: 'Non scaricato',
  unsupported: 'Non disponibile su questa piattaforma o build',
  auto: 'Automatico',
  anyLanguage: 'Molte lingue',
  languages: (named) => named.join(', '),
  languagesMore: (first, total) => `${first.join(', ')} e altre ${total - first.length}`,
};
