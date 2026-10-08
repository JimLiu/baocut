import type { JobsReconcileMessages } from './job-reconcile.ts';

export const fr: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `Cette tâche permet seulement : ${p.allowed}`,
  noneAllowed: "Aucune décision de rapprochement actuellement disponible pour cette tâche",
};
