import type { ToolFrameMessages } from './tool-frame.ts';

export const vi: ToolFrameMessages = {
  noneAvailable: (noun) => `Chưa có ${noun}; hãy thiết lập trong Cài đặt`,
  pickOne: (noun) => `Hãy chọn một ${noun} trước`,
  notInstalled: (name) => `${name} chưa được cài`,
  notConnected: (provider) => `${provider} chưa được kết nối`,
  unavailable: (name, why) => `${name} · ${why ?? 'Không khả dụng'}`,
  notInstalledWarning: (name) => `${name} chưa được cài. Chọn một mô hình đã cài hoặc tải xuống trong Cài đặt`,
  notConnectedWarning: (provider) => `${provider} chưa được kết nối. Chọn một nhà cung cấp hoạt động hoặc kết nối trong Cài đặt`,
  noModel: (noun, local) => (local ? `Chưa có ${noun}. Cài mô hình cục bộ hoặc kết nối dịch vụ đám mây trong Cài đặt.` : `Chưa có ${noun}. Kết nối dịch vụ đám mây trong Cài đặt.`),
};
