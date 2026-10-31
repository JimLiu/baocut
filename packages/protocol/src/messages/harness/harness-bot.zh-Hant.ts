import type { HarnessBotMessages } from './harness-bot.ts';

export const zhHant: HarnessBotMessages = {
  roleLocked: '這條對話屬於 Bot 的頻道或任務，請在頻道或任務設定裡改。',
  unattendedNeedsApprovals: (p) => `${p.agent} 不支援逐次核准，這一步需要你在場才能執行。`,
};
