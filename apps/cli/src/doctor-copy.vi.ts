import type { DoctorMessages } from './doctor-copy.ts';

export const vi: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'Vì sao BaoCut không khởi động hoặc không đọc được thứ gì đó: terminal tìm thấy baocut nào, CLI sẽ khởi chạy',
    'Runtime nào với thư mục nào, kho thông tin xác thực có phản hồi không, và Quyền truy cập toàn bộ ổ đĩa trên',
    'macOS. Mỗi mục kiểm tra là ok, warn, fail hoặc skip, kèm lệnh khắc phục nếu có; next là cách khắc phục cho',
    'vấn đề đầu tiên. Chỉ đọc: không bao giờ khởi chạy Runtime và không đọc khóa nào (mục chuỗi khóa chỉ hỏi một',
    'khóa bịa ra có tồn tại không). Hỏi người dùng trước khi chạy các lệnh khắc phục.',
    '',
    'Cờ: --json',
  ].join('\n'),
  checkName: {
    entry: 'Dòng lệnh',
    runtime: 'Runtime',
    credentials: 'Thông tin xác thực',
    fullDiskAccess: 'Quyền truy cập toàn bộ ổ đĩa',
  },
  remedyLabel: 'khắc phục',

  entryApp: (found, version) => `Terminal chạy ${found}, dòng lệnh của ứng dụng BaoCut${version ? ` ${version}` : ''}`,
  entryOtherApp: (found, target, app) =>
    `Terminal chạy ${found} (${target}), không phải dòng lệnh của ứng dụng BaoCut tại ${app}`,
  entryNoApp: (found, target) => `Terminal chạy ${found} (${target}); không tìm thấy ứng dụng BaoCut`,
  entryMissing: 'Terminal không tìm thấy baocut. Hãy cài từ ứng dụng BaoCut (không cần quyền quản trị).',
  entryMissingNoApp: 'Terminal không tìm thấy baocut và cũng không có ứng dụng BaoCut ở các vị trí thường gặp',

  runtimeRunning: (version, pid, by) =>
    `Đang chạy: phiên bản ${version}, tiến trình ${pid}, do ${by === 'cli' ? 'dòng lệnh' : 'ứng dụng BaoCut'} khởi chạy`,
  runtimeStopped: (entry) => `Không chạy. Lệnh tiếp theo sẽ khởi chạy nó trong nền bằng ${entry}`,
  runtimeUnreachable: (pid, reason) => `Có một Runtime đang chạy (tiến trình ${pid}) nhưng không phản hồi: ${reason}`,
  runtimeNoLaunch:
    'Không chạy và không có Runtime nào để khởi chạy: cài ứng dụng BaoCut, chạy từ kho hoặc đặt BAOCUT_RUNTIME_ENTRY đến điểm vào Runtime.',

  credentialsFile: (file) => `Bản dựng này lưu khóa trong tệp: ${file}`,
  credentialsKeychain: (platform) =>
    platform === 'win32' ? 'Trình quản lý thông tin xác thực của Windows có phản hồi' : 'Chuỗi khóa macOS có phản hồi',
  credentialsDenied:
    'Chuỗi khóa từ chối truy cập. Qua SSH hoặc khi chưa đăng nhập vào màn hình nền, macOS có thể giữ nó ở trạng thái khóa: chạy baocut trong terminal trên màn hình nền, hoặc mở khóa chuỗi khóa đăng nhập.',
  credentialsNoHelper: (file) =>
    `Thiếu trình trợ giúp thông tin xác thực${file ? ` (${file})` : ''} nên không đọc được khóa. Cài lại ứng dụng BaoCut.`,
  credentialsUnavailable: (reason) => `Không kết nối được kho thông tin xác thực: ${reason}`,
  credentialsUnknown: 'BAOCUT_RUNTIME_ENTRY quyết định nơi lưu khóa; chưa kiểm tra',
  credentialsTimedOut: (seconds) => `trình trợ giúp không phản hồi trong ${seconds} giây`,

  fdaGranted: 'Quyền truy cập toàn bộ ổ đĩa đang bật',
  fdaMissingApp:
    'Quyền truy cập toàn bộ ổ đĩa đang tắt cho BaoCut.app, nên có thể không đọc được tệp ở các vị trí được bảo vệ (Màn hình nền, Tài liệu, Tải về, các ổ đĩa khác). Bật BaoCut trong Cài đặt hệ thống › Quyền riêng tư & Bảo mật › Quyền truy cập toàn bộ ổ đĩa, rồi chạy lại baocut doctor.',
  fdaMissingCli: (app) =>
    `Quyền truy cập toàn bộ ổ đĩa đang tắt cho Runtime do dòng lệnh khởi chạy; macOS tính quyền này theo ${app ?? 'ứng dụng đã chạy lệnh (terminal của bạn, hoặc ứng dụng chạy Agent)'}. Bật ứng dụng đó trong Cài đặt hệ thống › Quyền riêng tư & Bảo mật › Quyền truy cập toàn bộ ổ đĩa rồi mở lại nó, hoặc dừng Runtime này (baocut runtime stop) rồi mở ứng dụng BaoCut; sau đó chạy lại baocut doctor.`,
  fdaNotRunning: 'Chỉ kiểm tra khi có Runtime đang chạy',
};
