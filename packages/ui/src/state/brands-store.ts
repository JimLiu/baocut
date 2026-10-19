import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { GLOBAL_BRAND_ID, type Id, type ProjectBrandSummary } from '@baocut/protocol';

/**
 * 全局的与各项目的 `BRAND.md`（`brands.list`，产品设计 §6.9「项目品牌与全局品牌」）在界面里的一份：Skills 页的「品牌」段、
 * 输入框上方的「品牌：…」标记与项目菜单共用。Runtime 不推送变化：挂上、重新连上、发出一条消息后各取一次；
 * 写入与生成返回这一份的摘要，拿到就换掉那一项。删除由界面移到废纸篓后去掉那一项。全局的总排第一，项目按名字。
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

const byName = (a: ProjectBrandSummary, b: ProjectBrandSummary) =>
  (a.scope === 'global' ? 0 : 1) - (b.scope === 'global' ? 0 : 1) || a.projectName.localeCompare(b.projectName);

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

/** 全局的 `BRAND.md`；还没有时 null。 */
export function useGlobalBrand(): ProjectBrandSummary | null {
  return useBrands((s) => s.brands.find((b) => b.projectId === GLOBAL_BRAND_ID) ?? null);
}

/** 一条会话实际带上的几份：项目的在前（优先），全局的在后（原型 model-project-brand.js `layers`）。 */
export function brandLayers(brands: readonly ProjectBrandSummary[], projectId: Id | null | undefined): ProjectBrandSummary[] {
  const project = projectId ? brands.find((b) => b.projectId === projectId && b.scope === 'project') : undefined;
  const global = brands.find((b) => b.projectId === GLOBAL_BRAND_ID);
  return [project, global].filter((b): b is ProjectBrandSummary => !!b);
}

export function useBrandLayers(projectId: Id | null | undefined): ProjectBrandSummary[] {
  return useBrands(useShallow((s) => brandLayers(s.brands, projectId)));
}
