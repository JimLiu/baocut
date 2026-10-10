import type { SpaceMessages } from './space-copy.ts';

export const vi: SpaceMessages = {
kind: { video: 'Video', export: 'Bản xuất', 'video-file': 'Tư liệu video', image: 'Hình ảnh', audio: 'Âm thanh', subtitle: 'Phụ đề', document: 'Tài liệu', package: 'Gói video', template: 'Mẫu' }, categoryAll: 'Tất cả', favorite: 'Yêu thích', trash: 'Thùng rác', sort: { created: 'Thời gian tạo', updated: 'Thời gian cập nhật', recent: 'Hoạt động gần đây', name: 'Tên', kind: 'Loại' }, status: { generating: 'Đang tạo', candidate: 'Phương án', applied: 'Đã áp dụng', published: 'Đã xuất bản', 'source-changed': 'Nguồn đã đổi', missing: 'Thiếu', failed: 'Thất bại' }, statusAny: 'Mọi trạng thái', statusNone: 'Không có trạng thái', noProject: 'Không thuộc dự án', removedProject: 'Dự án đã gỡ', conversation: (title) => `Phiên “${title}”`,
kindCount: (kind, n) => `${kind} ${n}`, foundFiles: (name, n) => (n === 1 ? `Tìm thấy: ${name}` : `Tìm thấy: ${name} và ${n - 1} tệp khác`), fileStatus: (kind, status) => `${kind}: ${status}`, filesStatus: (n, status) => `${n} tệp: ${status}`,
};
