import type { SubtitleRenderMessages } from './subtitleRender.ts';

export const vi: SubtitleRenderMessages = {
  startAnchorUnresolved: (p) => `Không xác định được mốc bắt đầu của phần tử ${p.element}; đã bỏ qua`,
  sourceSkipped: (p) => `Bản xem trước đã bỏ qua nguồn media ${p.source} và các phần tử của nó: ${p.detail}`,
  stickerAssetNoSource: (p) => `Sticker tài nguyên ${p.element} thiếu srcId; hãy đăng ký nó vào các nguồn của dòng thời gian (sticker mẫu dùng source=template kèm templateId)`,
  missingFont: (p) => `Phông "${p.family}" không có trong thư viện phông; dùng ${p.fallback} thay thế`,
  stickerRecolorFailed: (p) => `Không đổi được màu của nguồn sticker ${p.source} nên vẽ bằng màu gốc: ${p.detail}`,
};
