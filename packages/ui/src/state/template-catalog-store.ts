import { create } from 'zustand';
import type { TemplateDiagnostic, TemplateListResult } from '@baocut/protocol';
import { templateCatalogOf, type HomeTemplate } from '../model/home-templates.ts';

/**
 * Runtime 的模板目录（`templates.list`，模板包规范 §6）在界面里的一份：起始页与「全部模板」弹窗共用。
 * Runtime 不缓存目录、也不推送变化，所以由界面在起始页挂上、弹窗打开、重新连上时各取一次（runtime/template-commands.ts）。
 * 取过一次之后再取时旧的列表照常显示，取失败也不清掉，只有从没取到过时才显示加载中或失败。
 */
export interface TemplateCatalogStore {
  /** `loading`：正在取（不管之前有没有）；`failed`：最近一次没取到。 */
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** 取到过至少一次。 */
  loaded: boolean;
  templates: HomeTemplate[];
  diagnostics: TemplateDiagnostic[];
  error: string | null;
  begin(): void;
  succeed(result: TemplateListResult): void;
  fail(message: string): void;
}

/** 还没取过时的样子（测试里也用它复位）。 */
export function emptyTemplateCatalog(): Pick<TemplateCatalogStore, 'status' | 'loaded' | 'templates' | 'diagnostics' | 'error'> {
  return { status: 'idle', loaded: false, templates: [], diagnostics: [], error: null };
}

export const useTemplateCatalog = create<TemplateCatalogStore>()((set) => ({
  ...emptyTemplateCatalog(),
  begin: () => set({ status: 'loading' }),
  succeed: (result) =>
    set({ status: 'ready', loaded: true, templates: templateCatalogOf(result.templates), diagnostics: result.diagnostics, error: null }),
  fail: (message) => set({ status: 'failed', error: message }),
}));
