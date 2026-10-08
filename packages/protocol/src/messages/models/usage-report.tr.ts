import type { ModelsUsageReportMessages } from './usage-report.ts';

export const tr: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider} (hesap yok)`,
};
