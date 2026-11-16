import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Id, RecordingsEvent, RecordingSummary, RecordingTarget } from '@baocut/protocol';
import { COUNTDOWNS, DEFAULT_CHOICE, RECORDING_FPS, type RecordingChoice, type SourcesState } from '../model/recording.ts';

/** 录制面板从哪里打开：落点（新视频或当前视频）与等待中那次的 ID（智能体发起的）。 */
export interface RecordingPanelRequest {
  target: RecordingTarget | { home: { projectId: Id | null } };
  recordingId?: Id;
}

/**
 * 屏幕录制（`recordings` 主题，屏幕录制设计 §7、§11）的镜像与面板状态。只有外壳根上的 RecordingHost 订阅并写镜像；
 * 入口、面板、恢复提示与会话卡片读这里。Web 一直是空的。
 */
export interface RecordingsStore {
  ready: boolean;
  recordings: RecordingSummary[];
  sources: SourcesState;
  panel: RecordingPanelRequest | null;
  /** 这次启动里关掉过的等待中的录制（关面板就是 `recordings.cancel`，回答到之前不再自动弹）。 */
  dismissed: readonly Id[];
  replace(recordings: RecordingSummary[]): void;
  apply(event: RecordingsEvent): void;
  setSources(sources: SourcesState): void;
  openPanel(request: RecordingPanelRequest): void;
  closePanel(): void;
  dismiss(recordingId: Id): void;
}

export const useRecordings = create<RecordingsStore>()((set) => ({
  ready: false,
  recordings: [],
  sources: { status: 'idle' },
  panel: null,
  dismissed: [],
  replace: (recordings) => set({ ready: true, recordings }),
  apply: (event) =>
    set((s) => {
      if (event.type === 'recording.removed') return { recordings: s.recordings.filter((r) => r.recordingId !== event.recordingId) };
      const at = s.recordings.findIndex((r) => r.recordingId === event.recording.recordingId);
      if (at < 0) return { recordings: [event.recording, ...s.recordings] };
      const recordings = s.recordings.slice();
      recordings[at] = event.recording;
      return { recordings };
    }),
  setSources: (sources) => set({ sources }),
  openPanel: (panel) => set({ panel }),
  closePanel: () => set({ panel: null }),
  dismiss: (recordingId) => set((s) => ({ dismissed: s.dismissed.includes(recordingId) ? s.dismissed : [...s.dismissed, recordingId] })),
}));

/** 录制的全局快捷键（Electron accelerator 写法）；空串是不用。 */
export interface RecordingShortcuts {
  /** 开始录制（打开录制面板）：不录时一直占着这组键，缺省不用，由用户自己挑。 */
  start: string;
  stop: string;
  pause: string;
}

export const DEFAULT_SHORTCUTS: RecordingShortcuts = { start: '', stop: 'CommandOrControl+Shift+2', pause: 'CommandOrControl+Shift+3' };

/** 录制面板记住的选择与设置 › 录制的几项（按这台电脑记；设计 §11「面板记住上次的选择」）。 */
export interface RecordingPrefsStore {
  choice: RecordingChoice;
  shortcuts: RecordingShortcuts;
  /** 录制时收起 BaoCut 的窗口（缺省收起）。 */
  hideWindow: boolean;
  /** 屏幕的缺省帧率（用户在面板里开始的录制用它；智能体发起的用它给的）。 */
  fps: number;
  setChoice(choice: RecordingChoice): void;
  setShortcut(which: keyof RecordingShortcuts, accelerator: string): void;
  setHideWindow(on: boolean): void;
  setFps(fps: number): void;
  /** 缺省倒计时：改的是面板记住的那一项（面板里也能改，两处是同一个值）。 */
  setCountdown(seconds: number): void;
}

export const useRecordingPrefs = create<RecordingPrefsStore>()(
  persist(
    (set) => ({
      choice: DEFAULT_CHOICE,
      shortcuts: DEFAULT_SHORTCUTS,
      hideWindow: true,
      fps: RECORDING_FPS[0],
      setChoice: (choice) => set({ choice }),
      setShortcut: (which, accelerator) => set((s) => ({ shortcuts: { ...s.shortcuts, [which]: accelerator } })),
      setHideWindow: (hideWindow) => set({ hideWindow }),
      setFps: (fps) => set({ fps: knownFps(fps) }),
      setCountdown: (seconds) => set((s) => ({ choice: { ...s.choice, countdown: knownCountdown(seconds, s.choice.countdown) } })),
    }),
    {
      name: 'baocut.recording',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ choice: s.choice, shortcuts: s.shortcuts, hideWindow: s.hideWindow, fps: s.fps }),
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<RecordingPrefsStore>;
        return {
          ...current,
          choice: { ...DEFAULT_CHOICE, ...(s.choice ?? {}) },
          shortcuts: { ...DEFAULT_SHORTCUTS, ...(s.shortcuts ?? {}) },
          hideWindow: typeof s.hideWindow === 'boolean' ? s.hideWindow : current.hideWindow,
          fps: knownFps(s.fps),
        };
      },
    },
  ),
);

/** 只收设置里列出的帧率；别的（旧版本、手改的存储）退回缺省。 */
function knownFps(fps: unknown): number {
  return (RECORDING_FPS as readonly unknown[]).includes(fps) ? (fps as number) : RECORDING_FPS[0];
}

function knownCountdown(seconds: number, fallback: number): number {
  return (COUNTDOWNS as readonly number[]).includes(seconds) ? seconds : fallback;
}
