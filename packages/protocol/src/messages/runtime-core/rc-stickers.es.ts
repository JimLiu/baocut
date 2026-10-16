import type { RcStickersMessages } from './rc-stickers.ts';

export const es: RcStickersMessages = {
  stickerNotFound: (p) => `No se encontró el sticker: ${p.id}`,
  stickersMissing: 'Esta copia de BaoCut no incluye los stickers integrados',
  addStickerLabel: (p) => `Añadir el sticker «${p.name}»`,
};
