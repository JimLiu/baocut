import type { VideoInfoMessages } from './video-info-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: VideoInfoMessages = {
  section: { media: 'Fonte e mídia', source: 'Informações da fonte' },
  speakers: (count: number) => pluralForm('pt-BR', count, { one: `${count} falante`, other: `${count} falantes` }),
  chapters: (count: number) => pluralForm('pt-BR', count, { one: `${count} capítulo`, other: `${count} capítulos` }),
  paragraphs: (count: number) => pluralForm('pt-BR', count, { one: `${count} parágrafo`, other: `${count} parágrafos` }),
  list: (names: readonly string[]) => names.join(', '),
  sourceKind: { 'link-import': 'Importado de URL', 'user-import': 'Arquivo local', generated: 'Gerado', library: 'Biblioteca do usuário' },
  row: { contents: 'Conteúdo', translation: 'Tradução', location: 'Localização', media: 'Mídia', transcript: 'Transcrição', channel: 'Canal', published: 'Publicado', platform: 'Plataforma', mediaId: 'ID do vídeo', url: 'URL' },
};
