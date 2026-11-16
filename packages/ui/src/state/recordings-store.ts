import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Id, RecordingsEvent, RecordingSummary } from '@baocut/protocol';
import type { RecordingShortcutKey, RecordingShortcuts } from '../host.ts';
import { CAMERA, clampCameraSize, isCameraShape, isRatioId, type CameraShape } from '../model/recording-area.ts';
import { COUNTDOWNS, DEFAULT_CHOICE, RECORDING_FPS, type RecordingChoice, type SourcesState } from '../model/recording.ts';

export type { RecordingShortcutKey, RecordingShortcuts } from '../host.ts';

/**
 * 屏幕录制（`recordings` 主题，屏幕录制设计 §7、§11）的镜像与启动器是否开着。只有外壳根上的 RecordingHost 订阅并写镜像；
 * 入口、恢复提示与会话卡片读这里。Web 一直是空的。
 */
export interface RecordingsStore {
  ready: boolean;
  recordings: RecordingSummary[];
  sources: SourcesState;
  /** 录制启动器或选取覆盖层开着（主进程的小窗，`onSession`）。 */
  sessionOpen: boolean;
  /** 这次启动里关掉过的等待中的录制（关启动器就是 `recordings.cancel`，回答到之前不再自动打开）。 */
  dismissed: readonly Id[];
  replace(recordings: RecordingSummary[]): void;
  apply(event: RecordingsEvent): void;
  setSources(sources: SourcesState): void;
  setSessionOpen(open: boolean): void;
  dismiss(recordingId: Id): void;
}

export const useRecordings = create<RecordingsStore>()((set) => ({
  ready: false,
  recordings: [],
  sources: { status: 'idle' },
  sessionOpen: false,
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
  setSessionOpen: (sessionOpen) => set({ sessionOpen }),
  dismiss: (recordingId) => set((s) => ({ dismissed: s.dismissed.includes(recordingId) ? s.dismissed : [...s.dismissed, recordingId] })),
}));

/** 全局快捷键（Electron accelerator 写法）：缺省都不设，占着的组合键别的应用就用不了。 */
export const SHORTCUT_KEYS: readonly RecordingShortcutKey[] = ['launcher', 'display', 'window', 'area', 'stop', 'pause', 'restart'];
export const DEFAULT_SHORTCUTS: RecordingShortcuts = { launcher: '', display: '', window: '', area: '', stop: '', pause: '', restart: '' };
/** 旧版本的缺省快捷键：读到原样的旧缺省就当作没设。 */
const OLD_DEFAULT_SHORTCUTS: Partial<Record<string, string>> = { stop: 'CommandOrControl+Shift+2', pause: 'CommandOrControl+Shift+3' };

export const MAIN_WINDOW = ['background', 'minimize'] as const;
export const AFTER_DISCARD = ['none', 'launcher'] as const;
export type MainWindowMode = (typeof MAIN_WINDOW)[number];
export type AfterDiscard = (typeof AFTER_DISCARD)[number];

/** 摄像头浮窗记住的样子：大小（150–600）、形状、镜像、位置（屏幕全局坐标，画面的左上角；没拖过时 null）。 */
export interface CameraPrefs {
  size: number;
  shape: CameraShape;
  mirror: boolean;
  pos: { x: number; y: number } | null;
}
export const DEFAULT_CAMERA: CameraPrefs = { size: CAMERA.size, shape: 'round', mirror: true, pos: null };

/**
 * 启动器记住的选择与设置 › 通用 › 屏幕录制（按这台电脑记；设计 §11「记住上次的选择」）。主窗口与录制的小窗是同一个源，
 * 共用这一份 localStorage：小窗在开始时写选择，别的窗口在 `storage` 事件里读回来。
 */
export interface RecordingPrefsStore {
  choice: RecordingChoice;
  shortcuts: RecordingShortcuts;
  mainWindow: MainWindowMode;
  afterDiscard: AfterDiscard;
  /** 没选麦克风就开始时先确认。 */
  confirmNoMic: boolean;
  /** 菜单栏（托盘）图标。 */
  trayIcon: boolean;
  /** 屏幕的缺省帧率（用户自己开始的录制用它；智能体发起的用它给的）。 */
  fps: number;
  camera: CameraPrefs;
  setChoice(choice: RecordingChoice): void;
  setShortcut(which: RecordingShortcutKey, accelerator: string): void;
  setMainWindow(mode: MainWindowMode): void;
  setAfterDiscard(mode: AfterDiscard): void;
  setConfirmNoMic(on: boolean): void;
  setTrayIcon(on: boolean): void;
  setFps(fps: number): void;
  /** 缺省倒计时：录制卡的齿轮与设置改的是同一项。 */
  setCountdown(seconds: number): void;
  setCamera(patch: Partial<CameraPrefs>): void;
}

export const useRecordingPrefs = create<RecordingPrefsStore>()(
  persist(
    (set) => ({
      choice: DEFAULT_CHOICE,
      shortcuts: DEFAULT_SHORTCUTS,
      mainWindow: 'background',
      afterDiscard: 'none',
      confirmNoMic: true,
      trayIcon: true,
      fps: RECORDING_FPS[0],
      camera: DEFAULT_CAMERA,
      setChoice: (choice) => set({ choice }),
      setShortcut: (which, accelerator) => set((s) => ({ shortcuts: { ...s.shortcuts, [which]: accelerator } })),
      setMainWindow: (mainWindow) => set({ mainWindow }),
      setAfterDiscard: (afterDiscard) => set({ afterDiscard }),
      setConfirmNoMic: (confirmNoMic) => set({ confirmNoMic }),
      setTrayIcon: (trayIcon) => set({ trayIcon }),
      setFps: (fps) => set({ fps: knownFps(fps) }),
      setCountdown: (seconds) => set((s) => ({ choice: { ...s.choice, countdown: knownCountdown(seconds, s.choice.countdown) } })),
      setCamera: (patch) => set((s) => ({ camera: knownCamera({ ...s.camera, ...patch }) })),
    }),
    {
      name: 'baocut.recording',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        choice: s.choice,
        shortcuts: s.shortcuts,
        mainWindow: s.mainWindow,
        afterDiscard: s.afterDiscard,
        confirmNoMic: s.confirmNoMic,
        trayIcon: s.trayIcon,
        fps: s.fps,
        camera: s.camera,
      }),
      migrate: (persisted, version) => migrateRecordingPrefs(persisted, version),
      merge: (saved, current) => mergeRecordingPrefs(saved, current),
    },
  ),
);

/**
 * 第 1 版到第 2 版：开始录制的快捷键改叫打开启动器；停止与暂停的旧缺省（⌘⇧2、⌘⇧3）丢掉，用户自己改过的照旧；
 * 「录制时收起窗口」关着的换成最小化。
 */
export function migrateRecordingPrefs(persisted: unknown, version: number): unknown {
  const s = { ...((persisted ?? {}) as Record<string, unknown>) };
  if (version < 2) {
    const old = (s.shortcuts ?? {}) as Record<string, unknown>;
    const shortcuts: Record<string, unknown> = { ...old, launcher: old.start ?? '' };
    delete shortcuts.start;
    for (const [k, v] of Object.entries(OLD_DEFAULT_SHORTCUTS)) if (shortcuts[k] === v) shortcuts[k] = '';
    s.shortcuts = shortcuts;
    if (s.hideWindow === false) s.mainWindow = 'minimize';
    delete s.hideWindow;
  }
  return s;
}

/** 读回存下的：只认现在的字段，取值不在选项里就用缺省。 */
export function mergeRecordingPrefs(saved: unknown, current: RecordingPrefsStore): RecordingPrefsStore {
  const s = (saved ?? {}) as Partial<Record<keyof RecordingPrefsStore, unknown>>;
  const keys = (s.shortcuts ?? {}) as Partial<Record<string, unknown>>;
  const shortcuts = { ...DEFAULT_SHORTCUTS };
  for (const k of SHORTCUT_KEYS) if (typeof keys[k] === 'string') shortcuts[k] = keys[k] as string;
  const choice = { ...DEFAULT_CHOICE, ...((s.choice ?? {}) as Partial<RecordingChoice>) };
  if (!isRatioId(choice.ratio)) choice.ratio = DEFAULT_CHOICE.ratio;
  choice.countdown = knownCountdown(choice.countdown, DEFAULT_CHOICE.countdown);
  return {
    ...current,
    choice,
    shortcuts,
    mainWindow: (MAIN_WINDOW as readonly unknown[]).includes(s.mainWindow) ? (s.mainWindow as MainWindowMode) : current.mainWindow,
    afterDiscard: (AFTER_DISCARD as readonly unknown[]).includes(s.afterDiscard) ? (s.afterDiscard as AfterDiscard) : current.afterDiscard,
    confirmNoMic: typeof s.confirmNoMic === 'boolean' ? s.confirmNoMic : current.confirmNoMic,
    trayIcon: typeof s.trayIcon === 'boolean' ? s.trayIcon : current.trayIcon,
    fps: knownFps(s.fps),
    camera: knownCamera((s.camera ?? {}) as Partial<CameraPrefs>),
  };
}

// 别的窗口（录制的小窗、另一个主窗口）改了记下的选择或设置：读回来。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'baocut.recording') void useRecordingPrefs.persist.rehydrate();
  });
}

/** 只收设置里列出的帧率；别的（旧版本、手改的存储）退回缺省。 */
function knownFps(fps: unknown): number {
  return (RECORDING_FPS as readonly unknown[]).includes(fps) ? (fps as number) : RECORDING_FPS[0];
}

function knownCountdown(seconds: unknown, fallback: number): number {
  return (COUNTDOWNS as readonly unknown[]).includes(seconds) ? (seconds as number) : fallback;
}

function knownCamera(c: Partial<CameraPrefs>): CameraPrefs {
  const pos = c.pos && Number.isFinite(c.pos.x) && Number.isFinite(c.pos.y) ? { x: Math.round(c.pos.x), y: Math.round(c.pos.y) } : null;
  return {
    size: clampCameraSize(c.size),
    shape: isCameraShape(c.shape) ? c.shape : DEFAULT_CAMERA.shape,
    mirror: typeof c.mirror === 'boolean' ? c.mirror : DEFAULT_CAMERA.mirror,
    pos,
  };
}
