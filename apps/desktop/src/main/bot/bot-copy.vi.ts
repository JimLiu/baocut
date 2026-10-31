import type { BotMessages } from './bot-copy.ts';

export const vi: BotMessages = {
  trayOpen: 'Mở BaoCut',
  trayWorking: (count: number) => `Tác vụ đang chạy (${count})`,
  trayNoWorking: 'Không có tác vụ nào đang chạy',
  trayPause: 'Tạm dừng mọi tự động hóa',
  trayResume: 'Tiếp tục tự động hóa',
  trayQuit: 'Thoát dịch vụ chạy nền',
  trayTooltip: 'Dịch vụ chạy nền của BaoCut',
  trayTooltipNeedsYou: (count: number) => `BaoCut: ${count} việc đang chờ bạn`,
  trayTooltipPaused: 'BaoCut: đã tạm dừng tự động hóa',
  notifyMerged: (count: number, channel: string) => `${count} việc đang chờ bạn trong ${channel}`,
  notifySummary: (count: number) => `${count} việc đã chờ bạn qua đêm`,
  notifyReason: {
    'needs-review': 'Sẵn sàng để bạn xem lại',
    'needs-input': 'Cần bạn trả lời',
    reminder: 'Lời nhắc',
    'unattended-approval': 'Đang chờ bạn cho phép',
    stalled: 'Đã dừng, cần bạn xem',
  },
  residentQuitTitle: 'Bot sẽ tiếp tục làm việc ở chế độ nền',
  residentQuitDetailMac:
    'Khi bạn đóng BaoCut, ứng dụng vẫn chạy các tác vụ đã lên lịch và đang chạy từ thanh menu. Thoát hẳn để dừng mọi thứ.',
  residentQuitDetailOther:
    'Khi bạn đóng BaoCut, ứng dụng vẫn chạy các tác vụ đã lên lịch và đang chạy từ vùng thông báo. Thoát hẳn để dừng mọi thứ.',
  residentKeep: 'Giữ chạy nền',
  residentQuit: 'Thoát hẳn',
  quitServiceTitle: 'Thoát dịch vụ chạy nền?',
  quitServiceDetail: 'Bot sẽ ngừng cho đến khi bạn mở lại BaoCut. Các tác vụ đã lên lịch đến hạn trong thời gian đó sẽ được ghi là bị lỡ.',
  quitServiceThreads: (count: number) => `${count} tác vụ đang chạy sẽ dừng:`,
  quitServiceSchedules: (count: number) => `${count} tác vụ đã lên lịch sẽ không chạy:`,
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Thoát dịch vụ chạy nền',
  more: (count: number) => `và ${count} mục khác`,
  cancel: 'Hủy',
};
