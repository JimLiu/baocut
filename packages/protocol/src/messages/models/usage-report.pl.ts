import type { ModelsUsageReportMessages } from './usage-report.ts';

export const pl: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider} (brak konta)`,
};
