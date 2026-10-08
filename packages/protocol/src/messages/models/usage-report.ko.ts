import type { ModelsUsageReportMessages } from './usage-report.ts';

export const ko: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider}(계정 없음)`,
};
