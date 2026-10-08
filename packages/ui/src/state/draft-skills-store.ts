import { create } from 'zustand';

/**
 * 输入框「+ › 使用 Skill」点选的 skill（产品设计 §3.2.3、§6.9），按草稿键分（会话 ID 或新会话的草稿键）；一条消息最多一个，再选替换。
 * 只在这个窗口里，不持久化（同附图与起始页的模板）。换项目、新会话建好却没发出去时跟着输入框的话一起搬。
 */
interface DraftSkillsStore {
  /** 草稿键 → skill id。 */
  skills: Record<string, string>;
  set(draftKey: string, id: string | null): void;
  move(from: string, to: string): void;
}

export const useDraftSkills = create<DraftSkillsStore>()((set) => ({
  skills: {},
  set: (draftKey, id) =>
    set((s) => {
      if ((s.skills[draftKey] ?? null) === id) return {};
      const skills = { ...s.skills };
      if (id) skills[draftKey] = id;
      else delete skills[draftKey];
      return { skills };
    }),
  move: (from, to) =>
    set((s) => {
      const id = s.skills[from];
      if (!id || from === to) return {};
      const skills = { ...s.skills, [to]: id };
      delete skills[from];
      return { skills };
    }),
}));

export function useDraftSkillId(draftKey: string): string | null {
  return useDraftSkills((s) => s.skills[draftKey] ?? null);
}
