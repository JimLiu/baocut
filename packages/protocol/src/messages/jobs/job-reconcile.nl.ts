import type { JobsReconcileMessages } from './job-reconcile.ts';

export const nl: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `Deze taak kan alleen: ${p.allowed}`,
  noneAllowed: "Voor deze taak is nu geen afstemmingsbeslissing beschikbaar",
};
