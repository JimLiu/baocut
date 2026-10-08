import type { JobsReconcileMessages } from './job-reconcile.ts';

export const tr: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `Bu görev yalnızca: ${p.allowed}`,
  noneAllowed: 'Bu görevin şu anda kullanılabilir mutabakat kararı yok',
};
