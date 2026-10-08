import type { ModelsUsageReportMessages } from './usage-report.ts';

export const zhHans: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider}（无账号）`,
};
