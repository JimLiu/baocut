import type { JobsCaptionLayerMessages } from './caption-layer.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: JobsCaptionLayerMessages = {
  label: 'Adicionar camada de legendas',
  noSource: 'Não há documento para adicionar uma camada de legendas',
  videoClosed: 'O vídeo foi fechado, então nenhuma camada de legendas foi adicionada. Abra o vídeo e tente novamente.',
  empty: 'O documento não tem legendas para mostrar, então nenhuma camada de legendas foi adicionada',
  notOnTimeline: 'Nenhum clipe na linha do tempo usa esta mídia, então as legendas não podem aparecer na tela. Nenhuma camada de legendas foi adicionada.',
  noDocumentId: 'A camada de legendas foi adicionada, mas o ID do documento não foi retornado',
  rejected: 'A transação para adicionar a camada de legendas foi rejeitada',
  documentGone: 'O documento da camada de legendas não está mais no vídeo',
  needsOutputStore: 'A leitura das legendas do Speech Worker exige o armazenamento de resultados',
  notSpeech: 'O documento não é uma transcrição',
  speechUnreadable: 'Não foi possível ler o corpo da transcrição',
  translationUnreadable: 'Não foi possível ler o corpo da tradução',
  unaligned: (p: { count: number }) => pluralForm('pt-BR', p.count, { one: `${p.count} unidade de tradução não está alinhada (alignment é null), então não é possível determinar seu tempo`, other: `${p.count} unidades de tradução não estão alinhadas (alignment é null), então não é possível determinar seus tempos` }),
  noSourceSpeech: 'Não foi possível encontrar a transcrição que originou esta tradução',
  subtitlesName: 'Legendas', translationName: 'Tradução', styleName: 'Estilo de legendas',
};
