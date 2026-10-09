import type { ThreadMessages } from './thread-copy.ts';

export const vi: ThreadMessages = {
 withDetail: (text, detail) => `${text} (${detail})`, copy: 'Sao chép', copied: 'Đã sao chép', copyFailed: 'Không sao chép được. Hãy thử lại', copyCode: 'Sao chép mã', copyReply: 'Sao chép câu trả lời này',
 change: { added: (n) => `Đã thêm ${n}`, updated: (n) => `Đã đổi ${n}`, deleted: (n) => `Đã xóa ${n}`, duration: (clock) => `Thời lượng ${clock}`, durationChange: (before, after) => `Thời lượng ${before} → ${after}`, revision: (before, after) => `Phiên bản ${before} → ${after}`, locked: 'Hiện không thể thay đổi video', undoStep: (videoName, label) => `Đã hoàn tác một bước trong “${videoName}”: ${label}`, changed: (videoName, label) => `Đã đổi “${videoName}”: ${label}`, aria: (label) => `Thay đổi video: ${label}` },
 message: { contextTitle: 'Trạng thái trình chỉnh sửa gửi cùng tin nhắn', context: (videoName, revision, playhead, selected) => `“${videoName}” · Phiên bản ${revision} · Đầu phát ${playhead}${selected ? ` · Đã chọn ${selected} clip` : ''}` }, output: { aria: (name, detail) => `${name}, ${detail}` }, steps: { more: (n) => `${n} đang chạy`, failed: (n) => `${n} bước thất bại`, thinking: 'Đang suy nghĩ', viewFile: (name) => `Xem ${name}`, input: 'Đầu vào', error: 'Lỗi', output: 'Đầu ra', waiting: 'Đợi đầu ra', noOutput: 'Không có đầu ra' },
};
