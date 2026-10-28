import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const vi: TextModelChoiceMessages = {
  placeholder: 'Chọn một mô hình văn bản',
  providers: 'Nhà cung cấp',
  agentReady: (provider) => `Agent · Dùng gói ${provider} của bạn · Chậm hơn API`,
  agentNote: (note) => `Agent · ${note}`,
  connected: (n) => `Đã kết nối · ${n} mô hình`,
  notConnected: 'Chưa kết nối · Kết nối trong Cài đặt',
  settings: 'Quản lý mô hình văn bản…',
  settingsSub: 'Kết nối nhà cung cấp API · Mô hình mặc định',
};
