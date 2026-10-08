import { create } from 'zustand';
import type { LegacyImportPrompt, LegacyImportRun } from '@baocut/protocol';

/**
 * 旧版项目导入（`legacy-import` 主题，架构设计 §2.7）：启动询问与这次启动的导入进度、结果。只有外壳根上的
 * LegacyImportHost 订阅并写这里（一个主题只有一个处理函数）；任务页、Home 顶上那一条与 rail 读这里。Web 一直是空的。
 */
export interface LegacyImportStore {
  prompt: LegacyImportPrompt | null;
  run: LegacyImportRun | null;
  /** Home 顶上那一条关掉的是哪一次结果（`runId:finishedAt`）：再有新的结果（重试跑完）会再出来。 */
  bannerClosed: string | null;
  set(state: { prompt: LegacyImportPrompt | null; run: LegacyImportRun | null }): void;
  closeBanner(key: string): void;
}

export const useLegacyImport = create<LegacyImportStore>()((set) => ({
  prompt: null,
  run: null,
  bannerClosed: null,
  set: ({ prompt, run }) => set({ prompt, run }),
  closeBanner: (key) => set({ bannerClosed: key }),
}));
