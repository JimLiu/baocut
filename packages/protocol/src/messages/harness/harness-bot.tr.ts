import type { HarnessBotMessages } from './harness-bot.ts';

export const tr: HarnessBotMessages = {
  roleLocked: 'Bu konuşma bir Bot kanalına veya görevine ait. Kanal ya da görev ayarlarından değiştirin.',
  unattendedNeedsApprovals: (p) => `${p.agent} adım adım onay isteyemediği için bu adımın siz oradayken çalışması gerekiyor.`,
};
