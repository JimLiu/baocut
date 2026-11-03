import type { SystemAccessMessages } from './system-access-copy.ts';

export const vi: SystemAccessMessages = {
  cardTitle: (names) => `Cho phép BaoCut đọc cookie của ${names}`,
  cardBody: "macOS yêu cầu cấp cho BaoCut “Quyền truy cập toàn bộ ổ đĩa” trước. Nhấp “Mở Cài đặt hệ thống”, BaoCut sẽ đưa bạn thẳng tới trang đó. BaoCut chỉ đọc các trình duyệt bạn đã chọn, không đọc gì khác.",
  openedTitle: "Bật BaoCut trong Cài đặt hệ thống rồi quay lại đây",
  openedBody: "Bật công tắc cạnh BaoCut. Khi macOS hỏi có thoát và mở lại BaoCut không, hãy chọn “Thoát và mở lại”. Nếu BaoCut không có trong danh sách, nhấp “+” dưới danh sách để thêm. Nếu macOS không đề nghị mở lại, hãy nhấp “Khởi động lại BaoCut” bên dưới.",
  open: "Mở Cài đặt hệ thống",
  openAgain: "Mở lại Cài đặt hệ thống",
  restart: "Khởi động lại BaoCut",
  askTitle: (names) => `Cho phép truy cập cookie của ${names} trước?`,
  askBody: (names) => `Lượt tải này dùng trạng thái đăng nhập ${names} của bạn, và macOS yêu cầu cấp cho BaoCut “Quyền truy cập toàn bộ ổ đĩa” trước. Hãy bật trong Cài đặt hệ thống rồi tải lại, hoặc bỏ qua lần này và tiếp tục với các trình duyệt khác.`,
  skip: "Bỏ qua lần này",
  settingLabel: "Quyền truy cập toàn bộ ổ đĩa",
  settingAllowed: "Đã cho phép. BaoCut có thể đọc tệp trên ổ ngoài, Màn hình nền, Tài liệu, Tải xuống và cookie của Safari, nhưng chỉ đọc tư liệu, nơi lưu và trình duyệt bạn chọn.",
  settingMissing: "Chưa cho phép. macOS chặn ứng dụng đọc ổ ngoài, Màn hình nền, Tài liệu, Tải xuống và cookie của Safari. Sau khi cho phép, BaoCut sẽ không còn lỗi do thiếu quyền ở các vị trí này. Chỉ đọc tư liệu, nơi lưu và trình duyệt bạn chọn.",
  openFailed: "Không mở được Cài đặt hệ thống. Hãy tự mở Cài đặt hệ thống › Quyền riêng tư & Bảo mật › Quyền truy cập toàn bộ ổ đĩa.",
};
