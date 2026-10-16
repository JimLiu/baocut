import type { RcStickersMessages } from './rc-stickers.ts';

export const de: RcStickersMessages = {
  stickerNotFound: (p) => `Sticker nicht gefunden: ${p.id}`,
  stickersMissing: 'Diese BaoCut-Installation enthält die mitgelieferten Sticker nicht',
  addStickerLabel: (p) => `Sticker „${p.name}“ hinzufügen`,
};
