import type { QuestionMessages } from './question-copy.ts';

export const vi: QuestionMessages = {
  title: 'Agent có một câu hỏi',
  titleMany: (n) => `Agent có ${n} câu hỏi`,
  pickOne: 'Chọn một',
  pickMany: 'Chọn tất cả mục phù hợp',
  other: 'Khác',
  otherPlaceholder: 'Nhập câu trả lời của bạn',
  submit: 'Gửi câu trả lời',
  skip: 'Bỏ qua',
  hint: 'Bạn cũng có thể trả lời ngay trong ô tin nhắn.',
  kind: 'Câu hỏi',
  answered: 'Đã trả lời',
  skipped: 'Đã bỏ qua',
  byMessage: 'Đã trả lời bằng tin nhắn',
  cancelled: 'Đã dừng',
  noAnswer: 'Không có câu trả lời',
  failed: (message) => `Không gửi được: ${message}`,
};
