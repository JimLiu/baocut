import type { ModelsUsageReportMessages } from './usage-report.ts';

export const ja: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider}（アカウントなし）`,
};
