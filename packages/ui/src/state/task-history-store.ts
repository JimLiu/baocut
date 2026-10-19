import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * 后台任务「历史」的显示偏好（产品设计 §6.1）：清空到哪个结束时间记在本机（桌面端与 Web 各记各的），
 * 展开「显示更早的 N 项」只在这次打开期间有效。只决定列表里显示什么，任务记录与产物不动。
 */
export interface TaskHistoryStore {
  /** 不晚于这个结束时间（毫秒）的历史不再列出；没清空过是 null。 */
  clearedAt: number | null;
  showAll: boolean;
  setClearedAt(clearedAt: number | null): void;
  setShowAll(showAll: boolean): void;
}

export const useTaskHistory = create<TaskHistoryStore>()(
  persist(
    (set) => ({
      clearedAt: null,
      showAll: false,
      setClearedAt: (clearedAt) => set({ clearedAt, showAll: false }),
      setShowAll: (showAll) => set({ showAll }),
    }),
    {
      name: 'baocut.task-history',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ clearedAt }) => ({ clearedAt }),
      // 读回的不是有限的数就当没清空过。
      merge: (persisted, current) => {
        const at = (persisted as { clearedAt?: unknown } | undefined)?.clearedAt;
        return { ...current, clearedAt: typeof at === 'number' && Number.isFinite(at) ? at : null };
      },
    },
  ),
);
