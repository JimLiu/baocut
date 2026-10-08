import type { JobsReconcileMessages } from './job-reconcile.ts';

export const zhHant: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `這個任務只能：${p.allowed}`,
  noneAllowed: '這個任務目前沒有可用的對帳決定',
};
