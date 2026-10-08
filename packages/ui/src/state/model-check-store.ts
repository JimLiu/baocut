import { create } from 'zustand';
import type { CheckRejection } from '../model/model-check.ts';

/**
 * 本地模型「检查」里 Runtime 不知道的两件事，按模型包 ID 记（model/model-check.ts）：
 * - `rejections`：最近一次提交检查被拒（检查没能开始），下一次提交时清掉；
 * - `repairs`：这一行发起的修复任务，修完后自动再检查一次，然后清掉。
 * 只在这次运行里有效，不落盘；离开设置页再回来还在。
 */
export interface ModelCheckStore {
  rejections: Record<string, CheckRejection>;
  repairs: Record<string, string>;
  reject(bundleId: string, rejection: CheckRejection | null): void;
  setRepair(bundleId: string, jobId: string | null): void;
}

export const useModelCheck = create<ModelCheckStore>()((set) => ({
  rejections: {},
  repairs: {},
  reject: (bundleId, rejection) =>
    set((s) => {
      const next = { ...s.rejections };
      if (rejection) next[bundleId] = rejection;
      else delete next[bundleId];
      return { rejections: next };
    }),
  setRepair: (bundleId, jobId) =>
    set((s) => {
      const next = { ...s.repairs };
      if (jobId) next[bundleId] = jobId;
      else delete next[bundleId];
      return { repairs: next };
    }),
}));
