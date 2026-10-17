import type { RcStickersMessages } from './rc-stickers.ts';

export const ja: RcStickersMessages = {
  stickerNotFound: (p) => `ステッカーが見つかりません: ${p.id}`,
  stickersMissing: 'この BaoCut には同梱のステッカーが含まれていません',
  petNotFound: (p) => `Codex Pet が見つかりません：${p.id}`,
  onlineAssetUnavailable: (p) => `このステッカーをダウンロードできませんでした。ネットワーク接続を確認してもう一度お試しください（${p.reason}）`,
  addStickerLabel: (p) => `ステッカー「${p.name}」を追加`,
};
