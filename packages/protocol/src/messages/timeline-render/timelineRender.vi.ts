import type { TimelineRenderMessages } from './timelineRender.ts';

export const vi: TimelineRenderMessages = {
  shapeUnknown: (p) => `Phần tử ${p.element} dùng hình ${p.shape} chưa được đăng ký; đã bỏ qua`,
  shapeInvisible: (p) => `Hình ${p.shape} của phần tử ${p.element} không có tô màu cũng không có viền nên không vẽ gì cả`,
  stickerTemplateMissing: (p) => `Phần tử ${p.element} là sticker mẫu nhưng không có templateId; đã bỏ qua`,
  stickerTemplateUnknown: (p) => `Phần tử ${p.element} dùng mẫu sticker ${p.template} chưa được đăng ký; đã bỏ qua`,
  visualizerStyleUnknown: (p) => `Phần tử ${p.element} dùng kiểu dạng sóng ${p.style} chưa được đăng ký; đã bỏ qua`,
  spectrumNotInjected: (p) => `Phần tử ${p.element} không có rãnh phổ; vẽ khối giữ chỗ`,
  spectrumEmpty: (p) => `Rãnh phổ của phần tử ${p.element} trống; vẽ khối giữ chỗ`,
  progressStyleUnknown: (p) => `Phần tử ${p.element} dùng kiểu tiến trình ${p.style} chưa được đăng ký; đã bỏ qua`,
  confettiStyleUnknown: (p) => `Phần tử ${p.element} dùng kiểu hoa giấy ${p.style} chưa được đăng ký; đã bỏ qua`,
  spectrumUnavailable: (p) => `Kiểu ${p.kind} ${p.style} của phần tử ${p.element} không có dữ liệu phổ; vẽ khối giữ chỗ`,
  textureNoSource: (p) => `Texture ngoài của phần tử ${p.element} thiếu srcId`,
  textureSizeInvalid: (p) => `Texture ngoài của phần tử ${p.element} có kích thước không hợp lệ (${p.width}×${p.height})`,
  mediaBoxInvalid: (p) => `Hộp media của phần tử ${p.element} có kích thước không hợp lệ`,
  effectsOffGpu: (p) => `Hiệu ứng media của phần tử ${p.element} không chạy được trong cảnh texture GPU (${p.detail}); vẽ bằng ngăn xếp hiệu ứng CPU dùng chung`,
  cornerRadiiOffGpu: (p) => `Bo góc riêng từng góc của phần tử ${p.element} chưa được hỗ trợ trong cảnh texture GPU; vẽ bằng ngăn xếp hiệu ứng CPU dùng chung`,
  tileNodesOverLimit: (p) => `Media lát gạch của phần tử ${p.element} cần ${p.count} nút texture, vượt giới hạn thời gian thực ${p.limit}; vẽ trên máy chủ`,
};
