import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * 导出弹层跨会话记住的选择（设计稿偏好 `txFrontmatter`）：文稿页的「文首元信息」，没存过时勾选。
 * 只是界面的偏好，协议的默认值仍是不写（命令与协议规范 §4.4）。
 */
export interface ExportPrefsStore {
  transcriptFrontmatter: boolean;
  setTranscriptFrontmatter(on: boolean): void;
}

export const useExportPrefs = create<ExportPrefsStore>()(
  persist(
    (set) => ({
      transcriptFrontmatter: true,
      setTranscriptFrontmatter: (transcriptFrontmatter) => set({ transcriptFrontmatter }),
    }),
    {
      name: 'baocut.export',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ transcriptFrontmatter: s.transcriptFrontmatter }),
    },
  ),
);
