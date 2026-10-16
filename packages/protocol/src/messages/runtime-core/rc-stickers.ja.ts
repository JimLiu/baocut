import type { RcStickersMessages } from './rc-stickers.ts';

export const ja: RcStickersMessages = {
  stickerNotFound: (p) => `ステッカーが見つかりません: ${p.id}`,
  stickersMissing: 'この BaoCut には同梱のステッカーが含まれていません',
  addStickerLabel: (p) => `ステッカー「${p.name}」を追加`,
};
