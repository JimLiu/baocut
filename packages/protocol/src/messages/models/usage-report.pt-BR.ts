import type { ModelsUsageReportMessages } from './usage-report.ts';

export const ptBR: ModelsUsageReportMessages = {
  noAccount: (p: { provider: string }) => `${p.provider} (sem conta)`,
};
