import { create } from 'zustand';

/**
 * 输入框上点掉了「品牌：BRAND.md」的草稿（产品设计 §6.9「项目品牌」）：只管下一条，发出去后恢复。
 * 按草稿键（会话 id 或起始页的键）记，不落盘：重开应用后每条都照常带上项目的 `BRAND.md`。
 */
interface DraftBrandStore {
  skipped: Readonly<Record<string, true>>;
  set(draftKey: string, skip: boolean): void;
}

export const useDraftBrand = create<DraftBrandStore>()((set) => ({
  skipped: {},
  set: (draftKey, skip) =>
    set((s) => {
      if (!!s.skipped[draftKey] === skip) return s;
      const skipped = { ...s.skipped };
      if (skip) skipped[draftKey] = true;
      else delete skipped[draftKey];
      return { skipped };
    }),
}));

/** 这个草稿的下一条是否不带 `BRAND.md`。 */
export function useBrandSkipped(draftKey: string): boolean {
  return useDraftBrand((s) => !!s.skipped[draftKey]);
}
