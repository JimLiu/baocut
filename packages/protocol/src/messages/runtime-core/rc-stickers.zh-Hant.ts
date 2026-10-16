import type { RcStickersMessages } from './rc-stickers.ts';

export const zhHant: RcStickersMessages = {
  stickerNotFound: (p) => `找不到這張貼紙：${p.id}`,
  stickersMissing: '這份 BaoCut 沒有附帶內建貼紙',
  addStickerLabel: (p) => `加入貼紙「${p.name}」`,
};
