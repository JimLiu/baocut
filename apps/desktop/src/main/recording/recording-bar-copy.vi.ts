import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const vi: RecordingBarMessages = {
  launcherTitle: 'Ghi',
  pickerTitle: 'Chọn nội dung cần ghi',
  barTitle: 'Điều khiển ghi',
  cameraTitle: 'Xem trước camera',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `Dừng ghi · ${elapsed}`,
  trayFinishing: 'Đang hoàn tất…',
  trayOpen: 'Mở BaoCut',
  trayDisplay: 'Ghi màn hình',
  trayWindow: 'Ghi cửa sổ',
  trayArea: 'Ghi vùng',
  traySettings: 'Cài đặt…',
  trayQuit: 'Thoát BaoCut',
};
