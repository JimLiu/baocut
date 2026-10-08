import { create } from 'zustand';
import type { Id } from '@baocut/protocol';

/**
 * 导出位置（设计稿 export.jsx；架构设计 §9.13 `ExportDestination.dir`）：默认由 Runtime 决定（项目下的 `exports/`），
 * 桌面端的成片导到原视频所在的文件夹（`ExportEnv.sourceDir`）；用户点「选择位置」挑过的目录按视频记着，这次运行期间再导时沿用。导出进度不在这里——它在 jobs-store 的任务记录里。
 */
interface ExportPlaces {
  dirs: Record<Id, string>;
  setDir(videoId: Id, dir: string | null): void;
}

export const useExportPlaces = create<ExportPlaces>()((set) => ({
  dirs: {},
  setDir: (videoId, dir) =>
    set((s) => {
      const dirs = { ...s.dirs };
      if (dir) dirs[videoId] = dir;
      else delete dirs[videoId];
      return { dirs };
    }),
}));
