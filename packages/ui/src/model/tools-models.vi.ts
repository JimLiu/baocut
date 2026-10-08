import type { ToolsModelsMessages } from './tools-models.ts';

export const vi: ToolsModelsMessages = {
  notConnected: 'Chưa kết nối',
  unavailable: 'Không khả dụng',
  notDownloaded: 'Chưa tải xuống',
  unsupported: 'Không khả dụng trên nền tảng hoặc bản dựng này',
  auto: 'Tự động',
  anyLanguage: 'Nhiều ngôn ngữ',
  languages: (named) => named.join(', '),
  languagesMore: (first, total) => `${first.join(', ')} và ${total - first.length} ngôn ngữ khác`,
};
