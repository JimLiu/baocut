import type { RcStickersMessages } from './rc-stickers.ts';

export const ptBR: RcStickersMessages = {
  stickerNotFound: (p) => `Figurinha não encontrada: ${p.id}`,
  stickersMissing: 'Esta cópia do BaoCut não inclui as figurinhas integradas',
  addStickerLabel: (p) => `Adicionar figurinha “${p.name}”`,
};
