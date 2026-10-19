import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { HISTORY_PAGE } from '../model/task-list.ts';

/**
 * 后台任务「历史」的显示偏好（产品设计 §6.1）：清空到哪个结束时间记在本机（桌面端与 Web 各记各的），
 * 「显示更早的」每次多列 50 条，展开只在这次打开期间有效。只决定列表里显示什么，任务记录与产物不动。
 */
export interface TaskHistoryStore {
  /** 不晚于这个结束时间（毫秒）的历史不再列出；没清空过是 null。 */
  clearedAt: number | null;
  /** 展开多列出的条数。 */
  more: number;
  setClearedAt(clearedAt: number | null): void;
  showMore(): void;
  collapse(): void;
}

export const useTaskHistory = create<TaskHistoryStore>()(
  persist(
    (set) => ({
      clearedAt: null,
      more: 0,
      setClearedAt: (clearedAt) => set({ clearedAt, more: 0 }),
      showMore: () => set((s) => ({ more: s.more + HISTORY_PAGE })),
      collapse: () => set({ more: 0 }),
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
