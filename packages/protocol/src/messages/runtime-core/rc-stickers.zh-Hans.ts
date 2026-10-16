import type { RcStickersMessages } from './rc-stickers.ts';

export const zhHans: RcStickersMessages = {
  stickerNotFound: (p) => `找不到这张贴纸：${p.id}`,
  stickersMissing: '这份 BaoCut 没有带随包贴纸',
  addStickerLabel: (p) => `加入贴纸「${p.name}」`,
};
