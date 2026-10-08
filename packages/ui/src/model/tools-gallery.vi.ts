import type { ToolsGalleryMessages } from './tools-gallery.ts';

export const vi: ToolsGalleryMessages = {
  transcode: 'Mã hóa trên máy tính này bằng ffmpeg · không tải lên',
  linkReady: 'Công cụ tải xuống sẵn sàng',
  pipelineMissing: 'Phiên bản Runtime này chưa có quy trình cho công cụ này nên hiện chưa thể dùng',
  withRemedy: (message, remedy) => `${message}. ${remedy}`,
  localModels: (n) => `${n} mô hình cục bộ`,
  cloudConnected: (n) => `Đã kết nối ${n} nhà cung cấp trực tuyến`,
  noSpeech: 'Chưa có mô hình tổng hợp giọng nói khả dụng',
  noImage: 'Chưa có mô hình tạo hình ảnh khả dụng',
  noText: 'Chưa có mô hình văn bản khả dụng',
};
