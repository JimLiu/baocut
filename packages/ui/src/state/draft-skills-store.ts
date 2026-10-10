import { create } from 'zustand';
import { appendSkillId } from '../model/agent-skills.ts';

/**
 * 输入框「+ › 使用 Skill」点选的 skill（产品设计 §3.2.3、§6.9），按草稿键分（会话 ID 或新会话的草稿键）；一条消息可以挂几个，
 * 按挂上的顺序，再选已经挂着的不重复添加，每个可以单独摘掉。
 * 只在这个窗口里，不持久化（同附图与起始页的模板）。换项目、新会话建好却没发出去时跟着输入框的话一起搬。
 */
interface DraftSkillsStore {
  /** 草稿键 → 按挂上顺序的 skill id。 */
  skills: Record<string, string[]>;
  /** 接在后面挂一个；已经挂着的不动。 */
  add(draftKey: string, id: string): void;
  /** 摘掉一个。 */
  remove(draftKey: string, id: string): void;
  /** 整组换成 `ids`（去重、保持顺序）；空的就是全部摘掉。 */
  set(draftKey: string, ids: readonly string[]): void;
  move(from: string, to: string): void;
}

const EMPTY: readonly string[] = [];

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export const useDraftSkills = create<DraftSkillsStore>()((set) => {
  const write = (draftKey: string, next: (ids: readonly string[]) => readonly string[]) =>
    set((s) => {
      const before = s.skills[draftKey] ?? EMPTY;
      const after = unique(next(before));
      if (after.length === before.length && after.every((id, i) => id === before[i])) return {};
      const skills = { ...s.skills };
      if (after.length) skills[draftKey] = after;
      else delete skills[draftKey];
      return { skills };
    });
  return {
    skills: {},
    add: (draftKey, id) => write(draftKey, (ids) => appendSkillId(ids, id)),
    remove: (draftKey, id) => write(draftKey, (ids) => ids.filter((x) => x !== id)),
    set: (draftKey, ids) => write(draftKey, () => ids),
    move: (from, to) =>
      set((s) => {
        const ids = s.skills[from];
        if (!ids?.length || from === to) return {};
        const skills = { ...s.skills, [to]: ids };
        delete skills[from];
        return { skills };
      }),
  };
});

/** 这个草稿键挂着的 skill，按挂上的顺序；没有时是同一个空数组（订阅不抖）。 */
export function useDraftSkillIds(draftKey: string): readonly string[] {
  return useDraftSkills((s) => s.skills[draftKey] ?? EMPTY);
}
