import type { JobsReconcileMessages } from './job-reconcile.ts';

export const zhHans: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `这个任务现在只能：${p.allowed}`,
  noneAllowed: '这个任务现在没有可做的对账决定',
};
