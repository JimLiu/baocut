import { create } from 'zustand';
import type { Id, ProjectBrandSummary } from '@baocut/protocol';

/**
 * 有 `BRAND.md` 的项目（`brands.list`，产品设计 §6.9「项目品牌」）在界面里的一份：Skills 页的「项目品牌」段、输入框上方的
 * 「品牌：BRAND.md」标记与项目菜单共用。Runtime 不推送变化：挂上、重新连上、发出一条项目会话的消息后各取一次；
 * 写入与生成返回这一个项目的摘要，拿到就换掉那一项。删除由界面移到废纸篓后去掉那一项。
 */
export interface BrandsStore {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  loaded: boolean;
  brands: ProjectBrandSummary[];
  error: string | null;
  begin(): void;
  succeed(brands: ProjectBrandSummary[]): void;
  fail(message: string): void;
  upsert(brand: ProjectBrandSummary): void;
  drop(projectId: Id): void;
}

export function emptyBrands(): Pick<BrandsStore, 'status' | 'loaded' | 'brands' | 'error'> {
  return { status: 'idle', loaded: false, brands: [], error: null };
}

const byName = (a: ProjectBrandSummary, b: ProjectBrandSummary) => a.projectName.localeCompare(b.projectName);

export const useBrands = create<BrandsStore>()((set) => ({
  ...emptyBrands(),
  begin: () => set({ status: 'loading' }),
  succeed: (brands) => set({ status: 'ready', loaded: true, brands: [...brands].sort(byName), error: null }),
  fail: (message) => set({ status: 'failed', error: message }),
  upsert: (brand) =>
    set((s) => ({ brands: [...s.brands.filter((b) => b.projectId !== brand.projectId), brand].sort(byName) })),
  drop: (projectId) => set((s) => ({ brands: s.brands.filter((b) => b.projectId !== projectId) })),
}));

/** 这个项目的 `BRAND.md`；没有项目或还没有时是 null。 */
export function useProjectBrand(projectId: Id | null | undefined): ProjectBrandSummary | null {
  return useBrands((s) => (projectId ? (s.brands.find((b) => b.projectId === projectId) ?? null) : null));
}
