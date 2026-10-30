import type { PlanMessages } from './plan-copy.ts';

export const vi: PlanMessages = {
  title: 'Agent đã có kế hoạch, chờ bạn duyệt',
  modeLabel: 'Chế độ truy cập khi thực hiện',
  implement: 'Thực hiện theo kế hoạch',
  keepPlanning: 'Tiếp tục sửa kế hoạch',
  hint: 'Hoặc nói với agent cần sửa gì ngay trong ô nhập tin nhắn.',
  kind: 'Kế hoạch',
  approved: (mode) => `Đã duyệt · thực hiện ở “${mode}”`,
  declined: 'Chưa duyệt',
  byMessage: 'Đã trả lời bằng tin nhắn',
  cancelled: 'Đã dừng',
  rowLead: 'Kế hoạch ổn chưa?',
  followUp: 'Hãy thực hiện theo kế hoạch ở trên.',
  failed: (message) => `Không gửi được: ${message}`,
};
