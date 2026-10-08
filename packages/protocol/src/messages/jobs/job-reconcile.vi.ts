import type { JobsReconcileMessages } from './job-reconcile.ts';

export const vi: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `Tác vụ này chỉ có thể: ${p.allowed}`,
  noneAllowed: 'Tác vụ này hiện không có quyết định đối soát khả dụng',
};
