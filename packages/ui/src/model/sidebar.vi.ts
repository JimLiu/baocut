import type { SidebarMessages } from './sidebar.ts';

export const vi: SidebarMessages = {
status: { waiting: 'Đang chờ phê duyệt', failed: 'Thất bại', running: 'Đang xử lý', unread: 'Xong, chưa đọc' }, stopping: 'Đang dừng', count: { waiting: (n) => `${n} đang chờ phê duyệt`, failed: (n) => `${n} thất bại`, running: (n) => `${n} đang chạy`, unread: (n) => `${n} xong, chưa đọc` },
};
