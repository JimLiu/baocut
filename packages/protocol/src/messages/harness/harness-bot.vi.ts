import type { HarnessBotMessages } from './harness-bot.ts';

export const vi: HarnessBotMessages = {
  roleLocked: 'Cuộc trò chuyện này thuộc một kênh hoặc tác vụ của Bot. Hãy thay đổi trong cài đặt kênh hoặc tác vụ.',
  unattendedNeedsApprovals: (p) => `${p.agent} không thể xin phê duyệt từng bước, nên bước này cần bạn có mặt mới chạy được.`,
};
