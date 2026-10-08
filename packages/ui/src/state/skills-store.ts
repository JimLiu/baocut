import { create } from 'zustand';
import type { SkillDiagnostic, SkillListResult, SkillSummary } from '@baocut/protocol';
import { sortSkills } from '../model/agent-skills.ts';

/**
 * Runtime 的 skill 目录（`skills.list`，产品设计 §6.9）在界面里的一份：设置 › Skills 与输入框「+ › 使用 Skill」共用。
 * Runtime 不推送变化，由界面在设置页与输入框挂上、重新连上时各取一次（runtime/skill-commands.ts）；
 * 开关、添加、导入与移除都返回整份列表，拿到就整份写回。取过一次之后再取时旧的列表照常显示，取失败也不清掉。
 */
export interface SkillsStore {
  /** `loading`：正在取（不管之前有没有）；`failed`：最近一次没取到。 */
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** 取到过至少一次。 */
  loaded: boolean;
  skills: SkillSummary[];
  diagnostics: SkillDiagnostic[];
  error: string | null;
  begin(): void;
  /** 列表或变更类方法的结果：整份写回。 */
  succeed(result: SkillListResult): void;
  fail(message: string): void;
}

/** 还没取过时的样子（测试里也用它复位）。 */
export function emptySkills(): Pick<SkillsStore, 'status' | 'loaded' | 'skills' | 'diagnostics' | 'error'> {
  return { status: 'idle', loaded: false, skills: [], diagnostics: [], error: null };
}

export const useSkills = create<SkillsStore>()((set) => ({
  ...emptySkills(),
  begin: () => set({ status: 'loading' }),
  succeed: (result) =>
    set({ status: 'ready', loaded: true, skills: sortSkills(result.skills), diagnostics: result.diagnostics, error: null }),
  fail: (message) => set({ status: 'failed', error: message }),
}));
