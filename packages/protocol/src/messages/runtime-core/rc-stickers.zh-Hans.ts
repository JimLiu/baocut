import type { RcStickersMessages } from './rc-stickers.ts';

export const zhHans: RcStickersMessages = {
  stickerNotFound: (p) => `找不到这张贴纸：${p.id}`,
  stickersMissing: '这份 BaoCut 没有带随包贴纸',
  petNotFound: (p) => `找不到这只 Codex Pet：${p.id}`,
  onlineAssetUnavailable: (p) => `这张贴纸没能下载下来，检查网络后再试（${p.reason}）`,
  addStickerLabel: (p) => `加入贴纸「${p.name}」`,
};
