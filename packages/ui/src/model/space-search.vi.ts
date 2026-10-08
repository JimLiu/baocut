import type { SpaceSearchMessages } from './space-search.ts';

export const vi: SpaceSearchMessages = {
documentKind: { speech: 'Bản chép lời', caption: 'Phụ đề', translation: 'Bản dịch', chapter: 'Chương' }, pendingVideos: (count) => `Chỉ mục nội dung của ${count} video chưa cập nhật xong; kết quả có thể thiếu video hoặc lỗi thời`, indexUpdating: 'Chỉ mục nội dung đang cập nhật; kết quả có thể lỗi thời', truncated: (count) => `Quá nhiều kết quả; chỉ hiện ${count} mục đầu`, notes: (notes) => `${notes.join('; ')}.`, sourceTime: (clock) => `Thời gian tư liệu ${clock}`,
};
