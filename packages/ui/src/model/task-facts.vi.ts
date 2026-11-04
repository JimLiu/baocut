import type { TaskFactsMessages } from './task-facts.ts';

export const vi: TaskFactsMessages = {
  fact: {
    kind: 'Loại',
    submitter: 'Người khởi chạy',
    status: 'Trạng thái',
    startedAt: 'Bắt đầu',
    runsOn: 'Chạy trên',
    language: 'Ngôn ngữ',
    request: 'Chỉ dẫn',
    phase: 'Giai đoạn',
    images: 'Hình ảnh',
    took: 'Thời gian',
    left: 'Còn lại',
    cost: 'Chi phí',
  },
  imageCount: (count: number) => `${count} hình ảnh`,
};
