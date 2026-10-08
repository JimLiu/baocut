import type { ModelsUsageReportMessages } from './usage-report.ts';

export const fr: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider} (aucun compte)`,
};
