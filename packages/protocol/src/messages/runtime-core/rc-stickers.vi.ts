import type { RcStickersMessages } from './rc-stickers.ts';

export const vi: RcStickersMessages = {
  stickerNotFound: (p) => `Không tìm thấy nhãn dán: ${p.id}`,
  stickersMissing: 'Bản BaoCut này không kèm nhãn dán có sẵn',
  petNotFound: (p) => `Không tìm thấy Codex Pet: ${p.id}`,
  onlineAssetUnavailable: (p) => `Không tải được nhãn dán này. Hãy kiểm tra kết nối mạng rồi thử lại (${p.reason})`,
  addStickerLabel: (p) => `Thêm nhãn dán “${p.name}”`,
};
