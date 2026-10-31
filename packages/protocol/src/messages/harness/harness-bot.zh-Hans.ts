import type { HarnessBotMessages } from './harness-bot.ts';

export const zhHans: HarnessBotMessages = {
  roleLocked: '这条对话属于 Bot 的频道或任务，请在频道或任务设置里改。',
  unattendedNeedsApprovals: (p) => `${p.agent} 不支持逐次审批，这一步要你在场才能跑。`,
};
