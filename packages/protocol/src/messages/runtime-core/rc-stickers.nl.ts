import type { RcStickersMessages } from './rc-stickers.ts';

export const nl: RcStickersMessages = {
  stickerNotFound: (p) => `Sticker niet gevonden: ${p.id}`,
  stickersMissing: 'Deze BaoCut-installatie bevat de meegeleverde stickers niet',
  addStickerLabel: (p) => `Sticker ‘${p.name}’ toevoegen`,
};
