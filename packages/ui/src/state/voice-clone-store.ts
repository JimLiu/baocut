import { create } from 'zustand';
import { cloneAttemptKey, type CloneAttempt } from '../model/voices-library.ts';

/**
 * 我的声音里界面发起的克隆上传（保存后立即上传、⋯ 里的上传、失败后的补救）：提交拿到任务 ID 之后、任务经 `jobs` 主题
 * 送回来之前也显示在跑；提交时就被拒（没建任务）的错误也留下，好在那一行说清原因与怎么补。只在这次运行里有效，不落盘。
 */
export interface VoiceCloneStore {
  /** `cloneAttemptKey(voiceId, providerId)` → 最近一次。 */
  attempts: Record<string, CloneAttempt>;
  submitted(voiceId: string, providerId: string, jobId: string): void;
  rejected(voiceId: string, providerId: string, error: unknown): void;
}

export const useVoiceClones = create<VoiceCloneStore>()((set) => ({
  attempts: {},
  submitted: (voiceId, providerId, jobId) =>
    set((s) => ({ attempts: { ...s.attempts, [cloneAttemptKey(voiceId, providerId)]: { kind: 'submitted', jobId, at: Date.now() } } })),
  rejected: (voiceId, providerId, error) =>
    set((s) => ({ attempts: { ...s.attempts, [cloneAttemptKey(voiceId, providerId)]: { kind: 'rejected', error, at: Date.now() } } })),
}));
