import type { RcStickersMessages } from './rc-stickers.ts';

export const tr: RcStickersMessages = {
  stickerNotFound: (p) => `Çıkartma bulunamadı: ${p.id}`,
  stickersMissing: 'Bu BaoCut kopyası yerleşik çıkartmaları içermiyor',
  petNotFound: (p) => `Codex Pet bulunamadı: ${p.id}`,
  onlineAssetUnavailable: (p) => `Bu çıkartma indirilemedi. İnternet bağlantınızı kontrol edip yeniden deneyin (${p.reason})`,
  addStickerLabel: (p) => `Çıkartma ekle: “${p.name}”`,
};
