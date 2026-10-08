import type { ModelsUsageReportMessages } from './usage-report.ts';

export const ru: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider} (нет аккаунта)`,
};
