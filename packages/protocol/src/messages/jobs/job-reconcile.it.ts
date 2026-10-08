import type { JobsReconcileMessages } from './job-reconcile.ts';

export const it: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `Questa attività può solo: ${p.allowed}`,
  noneAllowed: "Questa attività non ha una decisione di riconciliazione disponibile al momento",
};
