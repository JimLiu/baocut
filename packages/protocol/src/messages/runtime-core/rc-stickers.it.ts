import type { RcStickersMessages } from './rc-stickers.ts';

export const it: RcStickersMessages = {
  stickerNotFound: (p) => `Sticker non trovato: ${p.id}`,
  stickersMissing: 'Questa copia di BaoCut non include gli sticker integrati',
  addStickerLabel: (p) => `Aggiungi lo sticker «${p.name}»`,
};
