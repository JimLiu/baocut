import type { RcStickersMessages } from './rc-stickers.ts';

export const pl: RcStickersMessages = {
  stickerNotFound: (p) => `Nie znaleziono naklejki: ${p.id}`,
  stickersMissing: 'Ta kopia BaoCut nie zawiera wbudowanych naklejek',
  addStickerLabel: (p) => `Dodaj naklejkę „${p.name}”`,
};
