import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { shelfAfterPick, type HomeTemplate } from '../model/home-templates.ts';

/**
 * 起始页模板网格摆哪几个（原型 prefs.homeTemplates.recent）：最近用过的模板的 id，记在这台电脑上。
 * 读出来时模板目录还没取到，所以这里只留字符串，不按目录过滤；摆的时候 `templateShelf(catalog, recent)` 过滤并补齐，
 * 选的时候按当时的目录重算一遍，旧版本存下的键（`tips`、`anim` 之类）就在第一次选时清掉。
 */
interface HomeTemplatesStore {
  recent: string[];
  /** 选了一个模板：不在网格里的排到最前。 */
  pick(id: string, catalog: readonly HomeTemplate[]): void;
}

/** 读出来的记忆只认字符串数组，别的一律当空。 */
export function recentOf(persisted: unknown): string[] {
  const recent = (persisted as { recent?: unknown } | null)?.recent;
  return Array.isArray(recent) ? recent.filter((k): k is string => typeof k === 'string' && k.length > 0) : [];
}

export const useHomeTemplates = create<HomeTemplatesStore>()(
  persist(
    (set) => ({
      recent: [],
      pick: (id, catalog) => set((s) => ({ recent: shelfAfterPick(catalog, s.recent, id) })),
    }),
    {
      name: 'baocut.homeTemplates',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ recent: s.recent }),
      merge: (persisted, current) => ({ ...current, recent: recentOf(persisted) }),
    },
  ),
);
