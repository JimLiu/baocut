import type { RcStickersMessages } from './rc-stickers.ts';

export const vi: RcStickersMessages = {
  stickerNotFound: (p) => `Không tìm thấy nhãn dán: ${p.id}`,
  stickersMissing: 'Bản BaoCut này không kèm nhãn dán có sẵn',
  addStickerLabel: (p) => `Thêm nhãn dán “${p.name}”`,
};
