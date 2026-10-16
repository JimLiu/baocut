import type { RcStickersMessages } from './rc-stickers.ts';

export const tr: RcStickersMessages = {
  stickerNotFound: (p) => `Çıkartma bulunamadı: ${p.id}`,
  stickersMissing: 'Bu BaoCut kopyası yerleşik çıkartmaları içermiyor',
  addStickerLabel: (p) => `Çıkartma ekle: “${p.name}”`,
};
