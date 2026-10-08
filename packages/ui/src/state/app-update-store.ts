import { create } from 'zustand';
import type { AppUpdateSnapshot } from '../host.ts';

/**
 * 应用自动更新的界面状态（设计稿 settings-update.jsx `AppUpdateProvider`）：主进程推来的快照的镜像，加上只属于界面的
 * 开合——更新窗、停止屏障的确认框、「等任务结束后安装」。状态机在主进程，这里不推演。宿主没有 `updates` 面时
 * `snapshot` 一直是 null，更新相关的界面一概不出现。
 *
 * 「等任务结束后安装」只记在这里：刷新窗口或重开应用就不等了，已下载的包还在，点「重启并更新」再来一次。
 */
export interface AppUpdateStore {
  snapshot: AppUpdateSnapshot | null;
  windowOpen: boolean;
  /** 打开更新窗的元素：关窗后焦点还给它（rail 上的按钮）。 */
  origin: HTMLElement | null;
  barrierOpen: boolean;
  waiting: boolean;
  setSnapshot(snapshot: AppUpdateSnapshot): void;
  openWindow(origin?: Element | null): void;
  closeWindow(): void;
  openBarrier(): void;
  closeBarrier(): void;
  setWaiting(waiting: boolean): void;
}

export const useAppUpdate = create<AppUpdateStore>()((set, get) => ({
  snapshot: null,
  windowOpen: false,
  origin: null,
  barrierOpen: false,
  waiting: false,
  setSnapshot: (snapshot) => set({ snapshot }),
  openWindow: (origin) => set({ windowOpen: true, origin: typeof HTMLElement !== 'undefined' && origin instanceof HTMLElement ? origin : null }),
  closeWindow: () => {
    const origin = get().origin;
    set({ windowOpen: false, origin: null });
    if (origin?.isConnected) setTimeout(() => origin.focus(), 0);
  },
  openBarrier: () => set({ barrierOpen: true }),
  closeBarrier: () => set({ barrierOpen: false }),
  setWaiting: (waiting) => set({ waiting }),
}));
