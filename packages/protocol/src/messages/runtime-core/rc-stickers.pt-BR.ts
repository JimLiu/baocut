import type { RcStickersMessages } from './rc-stickers.ts';

export const ptBR: RcStickersMessages = {
  stickerNotFound: (p) => `Figurinha não encontrada: ${p.id}`,
  stickersMissing: 'Esta cópia do BaoCut não inclui as figurinhas integradas',
  petNotFound: (p) => `Codex Pet não encontrado: ${p.id}`,
  onlineAssetUnavailable: (p) => `Não foi possível baixar este sticker. Verifique a conexão com a internet e tente de novo (${p.reason})`,
  addStickerLabel: (p) => `Adicionar figurinha “${p.name}”`,
};
