import type { SidebarMessages } from './sidebar.ts';

export const vi: SidebarMessages = {
status: { answer: 'Đang chờ bạn trả lời', waiting: 'Đang chờ phê duyệt', failed: 'Thất bại', running: 'Đang xử lý', unread: 'Xong, chưa đọc' }, stopping: 'Đang dừng', count: { answer: (n: number) => `${n} đang chờ bạn trả lời`, waiting: (n) => `${n} đang chờ phê duyệt`, failed: (n) => `${n} thất bại`, running: (n) => `${n} đang chạy`, unread: (n) => `${n} xong, chưa đọc` },
};
