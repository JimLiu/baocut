import { create } from 'zustand';
import { EMPTY_HOME_BRIEF, type HomeBriefState } from '../model/home-brief.ts';

/**
 * 起始页上还没发出去的模板与本机素材，按新会话的草稿键分（同输入框的草稿）。
 * 只在这个窗口里，不持久化：素材是本机路径，和附图一样随窗口走。
 * 起始页按项目重新挂载（换项目时），所以放在 store 里，换项目时整份搬过去。
 */
interface StartBriefStore {
  briefs: Record<string, HomeBriefState>;
  patch(draftKey: string, patch: Partial<HomeBriefState>): void;
  /** 发出去了：模板与素材都已经写进那条消息。 */
  clear(draftKey: string): void;
  /** 换项目：跟着输入框的话一起搬到那个项目的起始页。 */
  move(from: string, to: string): void;
}

export const useStartBrief = create<StartBriefStore>()((set) => ({
  briefs: {},
  patch: (draftKey, patch) =>
    set((s) => ({ briefs: { ...s.briefs, [draftKey]: { ...(s.briefs[draftKey] ?? EMPTY_HOME_BRIEF), ...patch } } })),
  clear: (draftKey) =>
    set((s) => {
      if (!(draftKey in s.briefs)) return {};
      const briefs = { ...s.briefs };
      delete briefs[draftKey];
      return { briefs };
    }),
  move: (from, to) =>
    set((s) => {
      const brief = s.briefs[from];
      if (!brief || from === to) return {};
      const briefs = { ...s.briefs, [to]: brief };
      delete briefs[from];
      return { briefs };
    }),
}));

export function useStartBriefOf(draftKey: string): HomeBriefState {
  return useStartBrief((s) => s.briefs[draftKey] ?? EMPTY_HOME_BRIEF);
}
