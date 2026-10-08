import { create } from 'zustand';
import type { QuickPick } from '../model/tts-quick-test.ts';

/** 一次提交的试听：任务 ID、提交时的请求身份与选择（结果行按它写）。 */
export interface QuickRun {
  jobId: string;
  key: string;
  pick: QuickPick;
}

/** 一行模型的试听草稿：选择、最近一次提交、上一段做成了的（最近一次没做成时仍放它）。 */
export interface QuickDraft {
  pick: QuickPick;
  run: QuickRun | null;
  last: QuickRun | null;
}

/**
 * 设置 › 模型 › 语音合成 › 本地模型的「试听」：哪几行展开着、每只模型的选择与最近的结果。按模型包 ID 记，收起、换页再回来都还在；
 * 只在这次运行里有效，不落盘。任务本身在 `jobs` 主题里，这里只记 ID。
 */
export interface TtsQuickStore {
  open: string[];
  drafts: Record<string, QuickDraft>;
  setOpen(bundleId: string, open: boolean): void;
  setDraft(bundleId: string, draft: QuickDraft): void;
}

export const useTtsQuick = create<TtsQuickStore>()((set) => ({
  open: [],
  drafts: {},
  setOpen: (bundleId, open) =>
    set((s) => ({ open: open ? (s.open.includes(bundleId) ? s.open : [...s.open, bundleId]) : s.open.filter((id) => id !== bundleId) })),
  setDraft: (bundleId, draft) => set((s) => ({ drafts: { ...s.drafts, [bundleId]: draft } })),
}));
