import type { ModelsUsageReportMessages } from './usage-report.ts';

export const nl: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider} (geen account)`,
};
