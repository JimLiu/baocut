import type { ModelsUsageReportMessages } from './usage-report.ts';

export const de: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider} (kein Konto)`,
};
