import type { ThreadMessages } from './thread-copy.ts';

export const vi: ThreadMessages = {
  videoTools: {
    videos_list: 'Liệt kê video',
    videos_create: 'Video mới',
    videos_inspect: 'Đọc video',
    edits_apply: 'Chỉnh sửa video',
    edits_undo: 'Hoàn tác chỉnh sửa',
  },
  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: 'Chạy lệnh', read: 'Đọc tệp', edit: 'Chỉnh sửa tệp', search: 'Tìm kiếm', other: 'Công cụ khác' },
  phrase: {
    command: 'đã chạy lệnh',
    read: (count: number) => `đã đọc ${count} tệp`,
    edit: (count: number) => `đã chỉnh sửa ${count} tệp`,
    search: 'đã tìm kiếm',
    video: (count: number) => `đã lưu ${count} chỉnh sửa video`,
    tool: 'đã gọi công cụ',
  },
  summary: (phrases: readonly string[]) => phrases.join(', '),
  thinking: 'Đang suy nghĩ',
  stepsFallback: 'Các bước',
};
