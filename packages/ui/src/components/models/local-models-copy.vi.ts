import type { LocalModelsMessages } from './local-models-copy.ts';

export const vi: LocalModelsMessages = {
install: { availableNote: 'Trước tải sẽ thấy kích thước cần tải và dung lượng đĩa còn. Có thể tạm dừng; giữ phần đã tải và tiếp tục lần tới.', download: 'Tải xuống', complete: 'Bổ sung', downloadSize: (size: string) => `Tải ${size}`, completeSize: (size: string) => `Bổ sung ${size}`, resume: 'Tiếp tục tải', pause: 'Tạm dừng', cancelDownload: 'Hủy tải', discard: 'Loại bỏ tệp đã tải', repair: 'Sửa…', remove: 'Xóa…', more: (id) => `Thêm · ${id}`, details: 'Chi tiết', hideDetails: 'Ẩn chi tiết', componentLine: (state, size) => state === 'installed' ? `Đã cài${size ? ` · ${size}` : ''}` : `Thiếu${size ? ` · ${size}` : ''}`, sharedWith: (ids) => `Dùng chung với ${ids.join(', ')}`, noComponents: 'Runtime này chưa báo chi tiết thành phần.',
  // 确认对话框
  installTitle: (id) => `Tải ${id}`, repairTitle: (id) => `Sửa “${id}”?`, completeTitle: (id) => `Bổ sung ${id}`, planning: 'Đang tính phần cần tải…', verifying: 'Đang tìm tệp hỏng hoặc thiếu. Tệp lớn có thể mất thời gian…', planFailed: 'Không lấy được kế hoạch tải', upToDate: 'Mọi tệp đã có và xác minh. Không có gì để tải.', completeNote: 'Mô hình đã được cài. Chỉ tải các thành phần tùy chọn còn thiếu; các tệp đã cài được giữ nguyên.', repairUpToDate: 'Mọi tệp nguyên vẹn. Không có gì để tải lại.', repairThenCheck: 'Chỉ tải lại tệp hỏng hoặc thiếu; giữ tệp nguyên vẹn. Tự kiểm tra lại sau sửa.', replanned: 'Kích thước tải vừa đổi. Đây là kế hoạch mới; xác nhận lại.', source: (url) => `Nguồn tải: ${url}`, confirmInstall: (size) => `Tải ${size}`, confirmRepair: 'Sửa', cancel: 'Hủy', close: 'Đóng', started: (id) => `Đang tải ${id} · tiến độ hiện trong hàng này và Tác vụ nền`,
  // 停下与删除
  paused: (id) => `Đã tạm dừng ${id} · giữ phần đã tải`, discardTitle: (id) => `Loại bỏ phần đã tải của ${id}?`, discardBody: 'Lần tải sau bắt đầu lại. Không xóa tệp gói mô hình khác đang tải hoặc thành phần chung.', discarded: (id) => `Đã loại bỏ phần đã tải của ${id}`, removeTitle: (id) => `Xóa ${id}?`, removeConfirm: 'Xóa', stopFailed: (text) => `Không dừng được: ${text}`, removeFailed: (text) => `Không xóa được: ${text}`, installFailed: (text) => `Lần tải cuối chưa hoàn tất: ${text}` },
  shared: {
    title: 'Thành phần dùng chung',
    note: 'Nhiều mô hình trong nhóm này cùng dùng. Mỗi thành phần chỉ cài một lần và được dọn cùng mô hình cuối cùng dùng nó.',
    summaryRepair: (n: number) => `${n} thành phần cần bổ sung`,
    summaryCount: (n: number) => `${n} thành phần dùng chung`,
    usage: (live: number, all: number) => `${live} mô hình đã cài đang dùng · tổng ${all} mô hình cần`,
    usageNone: (all: number) => `${all} mô hình sẽ dùng · chưa cài mô hình nào`,
    withModel: (size: string | null) => `Tải cùng mô hình đầu tiên bạn cài${size ? ` · ${size}` : ''}`,
    completeNote: (name: string) => `Thành phần dùng chung được tải cùng mô hình dùng nó. Lần này chỉ bổ sung phần “${name}” còn thiếu; tệp đã cài giữ nguyên.`,
  },
};
