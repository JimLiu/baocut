import type { SpaceSearchMessages } from './space-search.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: SpaceSearchMessages = {
  documentKind: { speech: 'Transcrição', caption: 'Legendas', translation: 'Tradução', chapter: 'Capítulo' },
  pendingVideos: (count: number) => `O índice de conteúdo de ${pluralForm('pt-BR', count, { one: `${count} vídeo`, other: `${count} vídeos` })} ainda não terminou de atualizar; os resultados podem omitir vídeos ou estar desatualizados`,
  indexUpdating: 'O índice de conteúdo está sendo atualizado; os resultados podem estar desatualizados',
  truncated: (count: number) => `Correspondências demais; mostrando apenas as primeiras ${count}`,
  notes: (notes: readonly string[]) => `${notes.join('; ')}.`,
  sourceTime: (clock: string) => `Tempo da mídia ${clock}`,
};
