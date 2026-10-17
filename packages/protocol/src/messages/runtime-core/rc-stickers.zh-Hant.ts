import type { RcStickersMessages } from './rc-stickers.ts';

export const zhHant: RcStickersMessages = {
  stickerNotFound: (p) => `找不到這張貼紙：${p.id}`,
  stickersMissing: '這份 BaoCut 沒有附帶內建貼紙',
  petNotFound: (p) => `找不到這隻 Codex Pet：${p.id}`,
  onlineAssetUnavailable: (p) => `這張貼紙沒能下載下來，檢查網路後再試（${p.reason}）`,
  addStickerLabel: (p) => `加入貼紙「${p.name}」`,
};
