import type { ModelsUsageReportMessages } from './usage-report.ts';

export const zhHant: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider}（無帳號）`,
};
