import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import type { FullDiskAccess } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { M } from '../model/system-access-copy.ts';
import { useRuntime } from '../runtime/context.tsx';

/**
 * macOS 的完全磁盘访问权限（产品设计 §7.9，架构设计 §12.11）：Runtime 报告的状态（`runtime.access`）与「已经打开过系统设置」这一步。
 * 授权卡、下载前的询问、失败卡上的按钮与设置 › 隐私与权限的那一行共用一份：回到应用时重新检测，授权生效后卡片自己消失。
 * 只有桌面宿主提供 `systemAccess` 时才取（Web 与别的系统没有这个桥，也不显示按钮）。
 */
interface AccessState {
  loaded: boolean;
  /** Runtime 所在主机的平台。 */
  platform: string | null;
  /** 只有 macOS 主机有。 */
  access: FullDiskAccess | undefined;
  /** `opened`：已经带用户去过系统设置，卡片改成等他启用并重新启动。 */
  step: 'idle' | 'opened';
  /** 这次运行里下载前的询问问过了：不再弹对话框，授权卡仍在。 */
  asked: boolean;
}

export const useAccessState = create<AccessState>()(() => ({ loaded: false, platform: null, access: undefined, step: 'idle', asked: false }));

export interface FullDiskAccessView {
  /** Runtime 报告的状态（桌面端能授权时才有值）。 */
  status: FullDiskAccess | undefined;
  /** 能直接带用户去授权：桌面宿主有桥、Runtime 在 macOS 上且报告了状态。 */
  actionable: boolean;
  /** 还没有允许（且能授权）：要显示授权卡、下载前要问。 */
  missing: boolean;
  /** 已经允许。 */
  granted: boolean;
  step: 'idle' | 'opened';
  asked: boolean;
  refresh(): void;
  /** 打开系统设置里的完全磁盘访问权限页。 */
  open(): Promise<void>;
  /** 为让授权生效重新启动（有活时主进程先确认）。 */
  restart(): Promise<void>;
  markAsked(): void;
}

/** 读状态；`enabled` 为真时检测一次，并在回到应用窗口时重新检测。 */
export function useFullDiskAccess(enabled = true): FullDiskAccessView {
  const runtime = useRuntime();
  const bridge = runtime.host.systemAccess;
  const state = useAccessState();
  const refresh = useCallback(() => {
    if (!bridge) return;
    runtime.access().then(
      ({ platform, fullDiskAccess }) => {
        useAccessState.setState((s) => ({
          loaded: true,
          platform,
          access: fullDiskAccess,
          // 授权生效后回到初始：下次再丢了授权从头说起。
          step: fullDiskAccess === 'granted' ? 'idle' : s.step,
        }));
      },
      () => useAccessState.setState({ loaded: true, access: undefined }),
    );
  }, [runtime, bridge]);
  useEffect(() => {
    if (!enabled || !bridge) return;
    if (!useAccessState.getState().loaded) refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [enabled, bridge, refresh]);
  const actionable = !!bridge && state.platform === 'darwin' && state.access !== undefined;
  return {
    status: actionable ? state.access : undefined,
    actionable,
    missing: actionable && state.access === 'missing',
    granted: actionable && state.access === 'granted',
    step: state.step,
    asked: state.asked,
    refresh,
    open: async () => {
      try {
        await bridge?.openFullDiskAccess();
        useAccessState.setState({ step: 'opened' });
      } catch {
        ToastQueue.negative(M.openFailed, { timeout: 8000 });
      }
    },
    restart: async () => {
      try {
        await bridge?.relaunch();
      } catch {
        ToastQueue.negative(M.openFailed, { timeout: 8000 });
      }
    },
    markAsked: () => useAccessState.setState({ asked: true }),
  };
}
