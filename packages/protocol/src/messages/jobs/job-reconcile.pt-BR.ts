import type { JobsReconcileMessages } from './job-reconcile.ts';

export const ptBR: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `Esta tarefa só pode: ${p.allowed}`,
  noneAllowed: "Esta tarefa não tem decisão de reconciliação disponível agora",
};
