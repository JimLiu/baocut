import type { JobsReconcileMessages } from './job-reconcile.ts';

export const de: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `Diese Aufgabe kann nur: ${p.allowed}`,
  noneAllowed: "Für diese Aufgabe ist derzeit keine Abgleichentscheidung verfügbar",
};
