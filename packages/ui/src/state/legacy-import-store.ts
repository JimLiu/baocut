import { create } from 'zustand';
import type { LegacyImportPrompt, LegacyImportRun, LegacyImportSnapshot, LegacySettingsReport } from '@baocut/protocol';

/**
 * 旧版项目导入（`legacy-import` 主题，架构设计 §2.7）：启动询问与持久保存的导入进度、结果。只有外壳根上的
 * LegacyImportHost 订阅并写这里（一个主题只有一个处理函数）；任务页、Home 顶上那一条与 rail 读这里。Web 一直是空的。
 */
export interface LegacyImportStore {
  /** 收到过主题快照：在这之前 `prompt` 为 null 不代表没有询问（首次启动引导等它，免得两个对话框叠在一起）。 */
  ready: boolean;
  /** 导入询问此刻正显示着（LegacyImportHost 写）：这次启动跳过了、已经回答了的不算。 */
  asking: boolean;
  prompt: LegacyImportPrompt | null;
  run: LegacyImportRun | null;
  settingsReport: LegacySettingsReport | null;
  settingsReportOpen: boolean;
  readSettingsReports: string[];
  settingsReadLoaded: boolean;
  /** Home 的导入结果提示已永久关闭；重启、重连或重试不再显示，导入进度仍可见。 */
  bannerDismissed: boolean;
  bannerDismissalLoaded: boolean;
  /** Only results of a run observed in progress can notify in this client. */
  bannerRunId: string | null;
  set(state: LegacyImportSnapshot): void;
  setAsking(asking: boolean): void;
  closeBanner(): void;
  openSettingsReport(): void;
  closeSettingsReport(): void;
}

const BANNER_DISMISSED_KEY = 'baocut.legacyImportBannerDismissed';

function readBannerDismissed(): boolean {
  try { return localStorage.getItem(BANNER_DISMISSED_KEY) === 'true'; }
  catch { return false; }
}

const SETTINGS_READ_KEY = 'baocut.legacySettingsRead';

/** Read acknowledgements only after Runtime supplies a report; ordinary users never enter this storage path. */
function readSettingsReports(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_READ_KEY) ?? 'null');
    const ids: unknown = saved?.version === 1 ? saved.state?.readSettingsReports : null;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  } catch { return []; }
}

export const useLegacyImport = create<LegacyImportStore>()((set) => ({
  ready: false,
  asking: false,
  prompt: null,
  run: null,
  settingsReport: null,
  settingsReportOpen: false,
  readSettingsReports: [],
  settingsReadLoaded: false,
  bannerDismissed: false,
  bannerDismissalLoaded: false,
  bannerRunId: null,
  set: ({ prompt, run, settingsReport }) => set((current) => {
    const report = settingsReport ?? null;
    const read = report && !current.settingsReadLoaded ? readSettingsReports() : current.readSettingsReports;
    return {
      ready: true,
      prompt, run, settingsReport: report,
      bannerRunId: run && run.state !== 'finished' ? run.runId : current.bannerRunId,
      bannerDismissed: run && !current.bannerDismissalLoaded ? readBannerDismissed() : current.bannerDismissed,
      bannerDismissalLoaded: current.bannerDismissalLoaded || run !== null,
      readSettingsReports: read,
      settingsReadLoaded: current.settingsReadLoaded || report !== null,
      settingsReportOpen: !!report && (
        (current.settingsReport?.reportId === report.reportId && current.settingsReportOpen)
        || !read.includes(report.reportId)
      ),
    };
  }),
  setAsking: (asking) => set({ asking }),
  closeBanner: () => {
    try { localStorage.setItem(BANNER_DISMISSED_KEY, 'true'); }
    catch { /* Keep dismissal for this window when local storage is unavailable. */ }
    set({ bannerDismissed: true, bannerDismissalLoaded: true });
  },
  openSettingsReport: () => set((current) => ({ settingsReportOpen: current.settingsReport !== null })),
  closeSettingsReport: () => set((current) => {
    if (!current.settingsReport) return { settingsReportOpen: false };
    const read = [...new Set([...current.readSettingsReports, current.settingsReport.reportId])];
    // Persist only opaque identifiers, and only when this user actually reads a legacy report.
    try { localStorage.setItem(SETTINGS_READ_KEY, JSON.stringify({ state: { readSettingsReports: read }, version: 1 })); }
    catch { /* Keep the acknowledgement for this window when local storage is unavailable. */ }
    return { settingsReportOpen: false, readSettingsReports: read };
  }),
}));
