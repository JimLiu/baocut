import type { RuntimeMessages } from './runtime-copy.ts';

export const vi: RuntimeMessages = {
  missingContext: 'Thiếu RuntimeContext',
  mediaStatus: (status) => `Dịch vụ tư liệu trả về ${status}`,
  noRootSequence: 'Video mới không có chuỗi chính',
  edit: {
    importAssets: 'Nhập tư liệu',
    setBackground: 'Đặt nền',
    addWaveform: 'Thêm dạng sóng',
  },
  waveformName: 'Dạng sóng',
  noDuration: 'Video chưa có thời lượng nên chưa thêm dạng sóng',
  noOpenVideo: 'Không có video nào đang mở',
  notCaughtUp: 'Video chưa đồng bộ kịp nên hiện chưa thể chỉnh sửa',
};
