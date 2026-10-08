import type { ToolsModelsMessages } from './tools-models.ts';

export const ptBR: ToolsModelsMessages = {
  notConnected: 'Não conectado',
  unavailable: 'Indisponível',
  notDownloaded: 'Não baixado',
  unsupported: 'Indisponível nesta plataforma ou compilação',
  auto: 'Automático',
  anyLanguage: 'Vários idiomas',
  languages: (named) => named.join(', '),
  languagesMore: (first, total) => `${first.join(', ')} e mais ${total - first.length}`,
};
