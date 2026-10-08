import type { JobsReconcileMessages } from './job-reconcile.ts';

export const ko: JobsReconcileMessages = {
  onlyAllowed: (p: { allowed: string }) => `이 작업은 다음만 할 수 있습니다: ${p.allowed}`,
  noneAllowed: '이 작업에는 지금 선택할 수 있는 조정 결정이 없습니다',
};
