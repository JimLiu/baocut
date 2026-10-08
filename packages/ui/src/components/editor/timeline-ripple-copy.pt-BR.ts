import type { TimelineRippleMessages } from './timeline-ripple-copy.ts';
import { secondsLabel } from './transcript-copy.ts';

export const ptBR: TimelineRippleMessages = {
  removeSpan: 'Excluir este trecho de todas as faixas',
  removeSpanHint: 'O conteúdo seguinte avança · a duração total diminui',
  removeSpanCaptions: 'As legendas cobrem o vídeo inteiro · Selecione um clipe',
  labelRemoveSpan: 'Excluir trecho de todas as faixas',
  closed: (deleted: string, seconds: number) => `${deleted} · Lacuna de ${secondsLabel(seconds)} fechada`,
  gapKept: (deleted: string) => `${deleted} · Lacuna mantida: há uma faixa ou clipe bloqueado depois`,
  removed: (seconds: number) => `${secondsLabel(seconds)} excluídos de todas as faixas · O conteúdo seguinte avançou`,
  pickSpan: 'Selecione primeiro um clipe na linha do tempo e depois exclua o trecho de todas as faixas',
  locked: 'Há uma faixa ou clipe bloqueado depois deste trecho · Desbloqueie primeiro',
};
