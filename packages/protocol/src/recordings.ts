import type { Id } from './domain.ts';
import type { JobError } from './jobs.ts';

/**
 * 屏幕录制（屏幕录制设计 §7、§11–§13）：Runtime 持有录制会话，Recording Worker 采集，停止之后收尾、导入成视频里的素材、
 * 录制清单、屏幕取景文档、实例与联动组。
 *
 * - 同一时刻只有一次录制（`RECORDING_BUSY`）。每次录制有自己的 `recordingId`（不是清单的文档 ID）：会话目录、导入的幂等键都按它。
 * - 会话里的智能体调 `record` 时录制停在 `waiting`：界面在 `recordings` 主题上看到它（`requestedBy` 是会话），弹出预先填好的面板；
 *   用户按开始（`recordings.start` 带 `recordingId`）才采集，关掉面板（`recordings.cancel`）任务以取消结束。
 * - 桌面端自己的入口直接 `recordings.start`（不带 `recordingId`）。
 * - 只录 Runtime 所在的这台电脑：Web 服务不开放 `recordings.*` 与这个主题。
 */

/** 录制的状态（屏幕录制设计 §7）。`in-timeline` 才算成功；`failed` 与 `discarded` 之前写下的文件留到用户恢复或删除。 */
export type RecordingState =
  | 'waiting'
  | 'preparing'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'finalizing'
  | 'importable'
  | 'importing'
  | 'in-timeline'
  | 'failed'
  | 'discarded';

export const RECORDING_STATES: readonly RecordingState[] = [
  'waiting',
  'preparing',
  'countdown',
  'recording',
  'paused',
  'stopping',
  'finalizing',
  'importable',
  'importing',
  'in-timeline',
  'failed',
  'discarded',
];

/** 录什么：一块屏幕（不给 ID 是主屏幕）、一个窗口、屏幕上的一块区域（逻辑点，`displayId` 不给是主屏幕）。 */
export type RecordingSource =
  | { kind: 'display'; displayId?: string }
  | { kind: 'window'; windowId: string }
  | { kind: 'area'; displayId?: string; rect: { x: number; y: number; width: number; height: number } };

export type RecordingCursorMode = 'separate' | 'baked' | 'none';
export type RecordingKeysMode = 'off' | 'shortcuts' | 'all';

/** 一次录制的选项（`record` 的参数，§12）。缺省见 `RECORDING_DEFAULTS`。 */
export interface RecordingOptions {
  source: RecordingSource;
  /** 摄像头的设备 ID；null 不录。 */
  camera: string | null;
  /** 麦克风的设备 ID；`'default'` 是系统缺省的麦克风；null 不录。 */
  microphone: string | null;
  systemAudio: boolean;
  cursor: RecordingCursorMode;
  keys: RecordingKeysMode;
  /** 屏幕的目标帧率。 */
  fps: number;
  /** 倒计时秒数；0 不倒计时。 */
  countdown: number;
  /** 到时自动停止（秒）；null 不限。 */
  duration: number | null;
  /** 收尾时生成自动缩放（还没实现：取景文档没有自动区间，见 `autoZoomPending`）。 */
  autoZoom: boolean;
  /** 完成后让桌面端打开编辑器。 */
  open: boolean;
}

export const RECORDING_DEFAULTS: RecordingOptions = {
  source: { kind: 'display' },
  camera: null,
  microphone: 'default',
  systemAudio: false,
  cursor: 'separate',
  keys: 'off',
  fps: 30,
  countdown: 3,
  duration: null,
  autoZoom: true,
  open: true,
};

/**
 * 录进哪个视频：已有的视频（素材入库，联动组放在 `at` 秒处的新轨道上，缺省 0），或新建一个（在项目或会话的来源目录里）。
 */
export type RecordingTarget =
  | { videoId: Id; at?: number }
  | { create: { name?: string; projectId?: Id; conversationId?: Id } };

/** 一路流此刻的样子（§12 `recordings status`）。 */
export interface RecordingStreamStatus {
  role: 'screen' | 'camera' | 'microphone' | 'system-audio' | 'pointer' | 'keyboard';
  device: { id?: string; name?: string } | null;
  /** 正在录（暂停与设备断开时 false）。 */
  active: boolean;
  /** 设备中途断开过（清单用 `coverage` 照实记下）。 */
  lost?: boolean;
}

/** 导入完成后的结果（`record` 与任务的结果）。 */
export interface RecordingResult {
  videoId: Id;
  /** 录制清单的文档 ID。 */
  manifestDocumentId: Id;
  screenViewDocumentId: Id;
  groupId: Id;
  itemIds: Id[];
  /** 有效录制长度（秒）。 */
  duration: number;
  /** 自动缩放还没有实现：取景文档里没有自动区间。 */
  autoZoomPending: boolean;
}

export interface RecordingSummary {
  recordingId: Id;
  state: RecordingState;
  /** 收尾与导入的后台任务（`kind: 'recording'`）；还没建（等待开始之前不会没有）时 null。 */
  jobId: Id | null;
  options: RecordingOptions;
  target: RecordingTarget;
  /** 智能体在会话里发起的（等界面按开始）。 */
  requestedBy: { conversationId: Id } | null;
  createdAt: string;
  /** 第一段开始采集的时刻；还没开始时 null。 */
  startedAt: string | null;
  /** 已录时长（秒，不含暂停）。 */
  elapsed: number;
  /** 倒计时剩下的秒数（只在 `countdown` 时有）。 */
  countdownLeft?: number;
  streams: RecordingStreamStatus[];
  /** 新建或录进的视频；新建的还没建出来时 null。 */
  videoId: Id | null;
  /** 上次 Runtime 退出时没有收完：可以 `recordings.recover` 或 `recordings.discard`。 */
  unfinished: boolean;
  /** 磁盘写下的文件（录制目录）。 */
  dir: string;
  error: JobError | null;
  result: RecordingResult | null;
}

/** 系统权限的状态。`unknown` 是这个平台问不出来。 */
export type SystemAccessState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

export interface RecordingPermissions {
  screen: SystemAccessState;
  camera: SystemAccessState;
  microphone: SystemAccessState;
  inputMonitoring: SystemAccessState;
}

/** 缺的系统权限（错误的 `details.systemAccess`）：哪一项、在系统设置里的位置（英文的路径，界面按自己的语言另说）。 */
export interface SystemAccessNeed {
  permission: keyof RecordingPermissions;
  state: SystemAccessState;
  settingsPath: string;
}

export interface RecordingDisplay {
  id: string;
  name: string;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
}

export interface RecordingWindow {
  id: string;
  title: string;
  app: string;
  width: number;
  height: number;
}

export interface RecordingDevice {
  id: string;
  name: string;
  default?: boolean;
}

/** `recordings_sources` 的结果（§12）。窗口的名字可能带出隐私：只在本机用，不进对外服务。 */
export interface RecordingSources {
  platform: string;
  /** 这台电脑此刻能不能录；不能时 `reason` 是英文的原因码（`unsupported-platform`、`no-worker`、`no-window`、`remote`……）。 */
  available: boolean;
  reason: string | null;
  permissions: RecordingPermissions;
  displays: RecordingDisplay[];
  windows: RecordingWindow[];
  cameras: RecordingDevice[];
  microphones: RecordingDevice[];
}

/** `recordings` 主题：快照是当前的与没有收完的录制（新的在前），变了逐条送整条摘要。 */
export interface RecordingsSnapshot {
  recordings: RecordingSummary[];
}

export type RecordingsEvent =
  | { type: 'recording.upsert'; recording: RecordingSummary }
  | { type: 'recording.removed'; recordingId: Id };

/** `recordings.start`：带 `recordingId` 时开始等待中的那一次（可以改选项），不带时新开一次（桌面端的入口）。 */
export interface RecordingStartParams {
  recordingId?: Id;
  options?: Partial<RecordingOptions>;
  target?: RecordingTarget;
}
