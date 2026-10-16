import type { RcStickersMessages } from './rc-stickers.ts';

export const fr: RcStickersMessages = {
  stickerNotFound: (p) => `Sticker introuvable : ${p.id}`,
  stickersMissing: 'Cette copie de BaoCut n’inclut pas les stickers intégrés',
  addStickerLabel: (p) => `Ajouter le sticker « ${p.name} »`,
};
