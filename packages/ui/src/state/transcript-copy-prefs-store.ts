import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { COPY_DEFAULTS, type TranscriptCopyPrefs } from '../model/transcript-copy-options.ts';

/**
 * 文稿面板复制记住的组合（设计稿偏好 `txCopy`）：改了复制设置就记住，下次一点复制钮就是这个组合。只是界面的偏好，
 * 跨会话记在本机（Web 也能用），不进 Runtime 的设置。
 */
export interface TranscriptCopyPrefsStore extends TranscriptCopyPrefs {
  set(patch: Partial<TranscriptCopyPrefs>): void;
}

export const useTranscriptCopyPrefs = create<TranscriptCopyPrefsStore>()(
  persist(
    (set) => ({
      ...COPY_DEFAULTS,
      set: (patch) => set(patch),
    }),
    {
      name: 'baocut.transcript-copy',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ format, frontmatter, chapters, timestamps, speakers, skipCut }) => ({ format, frontmatter, chapters, timestamps, speakers, skipCut }),
    },
  ),
);

/** 只取组合本身（不带 `set`），给计算用。 */
export function copyPrefsOf(store: TranscriptCopyPrefsStore): TranscriptCopyPrefs {
  const { format, frontmatter, chapters, timestamps, speakers, skipCut } = store;
  return { format, frontmatter, chapters, timestamps, speakers, skipCut };
}
