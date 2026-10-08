import type { JobsReconcileMessages } from './job-reconcile.ts';
export const es: JobsReconcileMessages = { onlyAllowed: (p) => `Esta tarea solo puede: ${p.allowed}`, noneAllowed: 'Esta tarea no tiene una decisión de conciliación disponible ahora' };
