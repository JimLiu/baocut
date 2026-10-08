import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Id } from '@baocut/protocol';

/**
 * 起始页记住的两样选择（产品设计 §3.2.1；原型 prefs.newProject 的 `dir`、`targetName`），记在这台电脑上（同模板网格）：
 * - `project`：托盘上次选的项目，null = 不用项目。只在托盘上选时记；别处带着项目来（侧栏「在这里新建会话」）只管那一次。
 * - `target`：「转录并翻译」上次填的目标语言（用户的原话，不是语言代码），没填过是 null。
 * 不放进 Runtime 的设置：这是界面上的顺手记忆，Web 会话也不能改设置。
 */
interface HomeMemoryStore {
  project: Id | null;
  target: string | null;
  setProject(project: Id | null): void;
  setTarget(target: string): void;
}

/** 读出来的记忆只认非空字符串，别的一律当没有。 */
export function memoryOf(persisted: unknown): { project: Id | null; target: string | null } {
  const value = (persisted ?? {}) as { project?: unknown; target?: unknown };
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { project: text(value.project), target: text(value.target) };
}

export const useHomeMemory = create<HomeMemoryStore>()(
  persist(
    (set) => ({
      project: null,
      target: null,
      setProject: (project) => set({ project }),
      setTarget: (target) => set({ target: target.trim() || null }),
    }),
    {
      name: 'baocut.homeMemory',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ project: s.project, target: s.target }),
      merge: (persisted, current) => ({ ...current, ...memoryOf(persisted) }),
    },
  ),
);
