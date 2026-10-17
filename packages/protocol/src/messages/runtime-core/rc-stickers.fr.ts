import type { RcStickersMessages } from './rc-stickers.ts';

export const fr: RcStickersMessages = {
  stickerNotFound: (p) => `Sticker introuvable : ${p.id}`,
  stickersMissing: 'Cette copie de BaoCut n’inclut pas les stickers intégrés',
  petNotFound: (p) => `Codex Pet introuvable : ${p.id}`,
  onlineAssetUnavailable: (p) => `Impossible de télécharger ce sticker. Vérifiez la connexion internet et réessayez (${p.reason})`,
  addStickerLabel: (p) => `Ajouter le sticker « ${p.name} »`,
};
