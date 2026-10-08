import type { JobsReconcileMessages } from './job-reconcile.ts';

export const ru: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `Для этой задачи доступны только: ${p.allowed}`,
  noneAllowed: 'Для этой задачи сейчас нет доступных решений по сверке',
};
