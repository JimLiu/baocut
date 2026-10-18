import { create } from 'zustand';
import type { Actor, FileTarget, Id, MessageRef, VideoRef, VideoSnapshotStatus, VideoTopicSnapshot, TransactionReceipt, UndoState } from '@baocut/protocol';

/**
 * 编辑器打开的视频：Runtime 镜像经主题同步过来的投影，以及这个窗口发出的命令的状态。
 * 视频的内容只由主题更新，界面不在本地改它（架构设计 §11.1）。
 */

/**
 * - `opening`：正在打开或重新打开。
 * - `ready`：已追平，可以提交修改。
 * - `stale`：连接断了或视频在 Runtime 里关闭了；显示的是最后看到的版本，不能提交（产品设计 §2.6）。
 * - `error`：打不开。
 */
export type VideoStatus = 'opening' | 'ready' | 'stale' | 'error';

export interface CommandError {
  message: string;
  /** 引擎的错误码，例如 `PROJECT_REVISION_CONFLICT`、`TIMELINE_OVERLAP`。 */
  code: string | null;
}

export interface OpenVideo {
  target: FileTarget;
  videoId: Id | null;
  ref: VideoRef | null;
  state: VideoTopicSnapshot | null;
  status: VideoStatus;
  error: string | null;
  /** 已发出、还没有回执的命令数。 */
  inFlight: number;
  lastReceipt: TransactionReceipt | null;
  /**
   * 最近一笔落到视频上的修改是谁做的（来自主题事件，包括别的窗口和智能体）。修改名用 `localizeText(label, labelRef)` 显示。
   * `actorId`、`transactionId` 与 `undoOf` 让版本记录认出 Runtime 导入的外部改动（`system:history`），并能撤销它。
   */
  lastChange: {
    by: Actor['kind'];
    label: string;
    labelRef?: MessageRef | undefined;
    actorId?: Id | undefined;
    transactionId?: Id | undefined;
    undoOf?: Id | undefined;
  } | null;
  commandError: CommandError | null;
  undo: UndoState;
  /** 收到过几次 `video.replaced`（引擎重启后整体替换）：素材状态要重查。 */
  replaced?: number;
  /** 工作区快照与视频库的关系（`videos.versions.status`，视频格式规范 §9.7），最近读到的那次：视频栏的版本记录入口与编辑器顶部的冲突提示共用。 */
  versionStatus?: VideoSnapshotStatus | null;
}

export interface VideoStore {
  video: OpenVideo | null;
  begin(target: FileTarget): void;
  update(patch: Partial<OpenVideo>): void;
  clear(): void;
}

export const useVideo = create<VideoStore>()((set) => ({
  video: null,
  begin: (target) =>
    set({
      video: {
        target,
        videoId: null,
        ref: null,
        state: null,
        status: 'opening',
        error: null,
        inFlight: 0,
        lastReceipt: null,
        lastChange: null,
        commandError: null,
        undo: {},
      },
    }),
  update: (patch) => set((s) => (s.video ? { video: { ...s.video, ...patch } } : {})),
  clear: () => set({ video: null }),
}));

/** 当前能不能提交修改：已追平、没有在重新打开。 */
export function canEdit(video: OpenVideo | null): boolean {
  return video?.status === 'ready' && video.state !== null;
}
