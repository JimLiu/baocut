import type { ModelsUsageReportMessages } from './usage-report.ts';

export const it: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider} (nessun account)`,
};
