import type { JobsReconcileMessages } from './job-reconcile.ts';

export const pl: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `W tym zadaniu można tylko: ${p.allowed}`,
  noneAllowed: 'Dla tego zadania nie ma teraz dostępnej decyzji uzgodnienia',
};
