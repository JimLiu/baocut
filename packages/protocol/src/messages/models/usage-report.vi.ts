import type { ModelsUsageReportMessages } from './usage-report.ts';

export const vi: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider} (không có tài khoản)`,
};
