import { useEffect } from 'react';
import { DialogContainer, ToastQueue } from '@react-spectrum/s2';
import type { AppUpdateNotice } from '../../host.ts';
import { availableToast, dialog, NOTES_LANG, readyToast, sideButton } from '../../model/app-update.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useAppUpdate } from '../../state/app-update-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { InstallBarrier } from './install-barrier.tsx';
import { UpdateWindow } from './update-window.tsx';
import { installNow, requestRestart } from './use-update-actions.ts';
import { useWaitingCount } from './use-waiting-count.ts';

/*
 * 应用更新的宿主（设计稿 settings-update.jsx `AppUpdateProvider`）：挂在外壳根上，离开设置页照样收主进程的状态、弹 toast。
 * 它把主进程推来的快照放进 `useAppUpdate`，把 Runtime 持有的 `updates.autoCheck` / `updates.autoDownload` 推给主进程，
 * 开合更新窗与停止屏障，并在「等任务结束后安装」时数着任务、数到零就安装。宿主没有 `updates` 面（网页）时什么都不做。
 */

const TOAST_TIMEOUT = 10_000;

/** toast「查看」：更新窗这一态能开就开；开不了（已经变了态）就去设置 › 关于看。 */
function openUpdate(): void {
  const state = useAppUpdate.getState().snapshot?.state;
  if (state && sideButton(state).visible) useAppUpdate.getState().openWindow();
  else useShell.getState().go({ tab: 'settings', section: 'about' });
}

function showNotice(runtime: RuntimeSession, notice: AppUpdateNotice): void {
  if (notice.kind === 'ready') {
    const t = readyToast(notice.info);
    ToastQueue.positive(t.text, { timeout: TOAST_TIMEOUT, actionLabel: t.action, onAction: () => requestRestart(runtime), shouldCloseOnAction: true });
  } else {
    const t = availableToast(notice.info);
    ToastQueue.info(t.text, { timeout: TOAST_TIMEOUT, actionLabel: t.action, onAction: openUpdate, shouldCloseOnAction: true });
  }
}

export function AppUpdateHost() {
  const runtime = useRuntime();
  const updates = runtime.host.updates;
  const setSnapshot = useAppUpdate((s) => s.setSnapshot);

  // 状态镜像与提醒。先订阅再取一次：取回来之前已经推来过新状态的话，取回来的那份作废。
  useEffect(() => {
    if (!updates) return;
    let alive = true;
    let pushed = false;
    const offState = updates.onState((snapshot) => {
      pushed = true;
      setSnapshot(snapshot);
    });
    const offNotice = updates.onNotice((notice) => showNotice(runtime, notice));
    updates.get().then(
      (snapshot) => {
        if (alive && !pushed) setSnapshot(snapshot);
      },
      () => {},
    );
    return () => {
      alive = false;
      offState();
      offNotice();
    };
  }, [runtime, updates, setSnapshot]);

  // 偏好在 Runtime 那边：设置镜像到了才推；主进程在收到之前不自动检查。
  const autoCheck = useSetting('updates.autoCheck');
  const autoDownload = useSetting('updates.autoDownload');
  useEffect(() => {
    if (!updates || autoCheck === null || autoDownload === null) return;
    updates.configure({ autoCheck, autoDownload });
  }, [updates, autoCheck, autoDownload]);

  const snapshot = useAppUpdate((s) => s.snapshot);
  const windowOpen = useAppUpdate((s) => s.windowOpen);
  const closeWindow = useAppUpdate((s) => s.closeWindow);
  const waitingFor = useWaitingCount();
  const view = snapshot ? dialog(snapshot.state, { lang: NOTES_LANG, current: snapshot.current, waiting: waitingFor }) : null;

  // 窗只在 rail 按钮该显示的态里开着：变成安装中、空闲、检查失败这类态时自己关。
  const viewable = view !== null;
  useEffect(() => {
    if (windowOpen && !viewable) closeWindow();
  }, [windowOpen, viewable, closeWindow]);

  // 「等任务结束后安装」：包还在就等着，任务数到零就安装；包没了（取消、出错、重新检查）就不等了。
  const stateKind = snapshot?.state.k ?? null;
  useEffect(() => {
    if (waitingFor === null) return;
    if (stateKind !== 'ready' && stateKind !== 'installing') useAppUpdate.getState().setWaiting(false);
    else if (stateKind === 'ready' && waitingFor === 0) installNow(runtime);
  }, [runtime, stateKind, waitingFor]);

  if (!updates) return null;
  return (
    <>
      <DialogContainer onDismiss={closeWindow}>{windowOpen && view ? <UpdateWindow view={view} onClose={closeWindow} /> : null}</DialogContainer>
      <InstallBarrier />
    </>
  );
}
