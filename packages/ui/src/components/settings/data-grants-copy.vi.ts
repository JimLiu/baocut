import type { DataGrantsMessages } from './data-grants-copy.ts';

export const vi: DataGrantsMessages = {
 title: 'Ủy quyền chia sẻ dữ liệu', showEnded: (count) => `Hiện ủy quyền đã kết thúc (${count})`,
 lead: 'Gửi dữ liệu đến nhà cung cấp đám mây cần ủy quyền: một ủy quyền được cấp mặc định khi bật nhà cung cấp, và một ủy quyền khác khi chọn “Luôn cho phép” lúc phê duyệt. Sau khi thu hồi, các cuộc gọi mới không gửi dữ liệu ra ngoài; dữ liệu đã gửi và phí đã phát sinh không thể lấy lại. Mô hình cục bộ không cần ủy quyền.',
 loading: 'Đang tải ủy quyền…', disconnected: 'Chưa kết nối với Runtime', revoke: 'Thu hồi', noActive: 'Không có ủy quyền đang hiệu lực', none: 'Chưa có ủy quyền', emptyDesc: 'Ủy quyền xuất hiện ở đây khi bật nhà cung cấp đám mây hoặc chọn “Luôn cho phép” lúc phê duyệt.',
 revokeTitle: (name) => `Thu hồi “${name}”?`, revokeFailed: (message) => `Không thu hồi được: ${message}`, cancel: 'Hủy',
};
