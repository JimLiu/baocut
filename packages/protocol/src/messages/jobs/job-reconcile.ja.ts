import type { JobsReconcileMessages } from './job-reconcile.ts';

export const ja: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `このタスクで現在できるのは次の操作のみです：${p.allowed}`,
  noneAllowed: 'このタスクで現在選べる照合の決定はありません',
};
