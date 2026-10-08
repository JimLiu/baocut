import type { ToolsModelsMessages } from './tools-models.ts';
export const es: ToolsModelsMessages = {
  notConnected: 'Sin conexión', unavailable: 'No disponible', notDownloaded: 'Sin descargar',
  unsupported: 'No disponible en esta plataforma o compilación', auto: 'Automático', anyLanguage: 'Muchos idiomas',
  languages: (named: readonly string[]) => named.join(', '),
  languagesMore: (first: readonly string[], total: number) => `${first.join(', ')} y ${total - first.length} más`,
};
