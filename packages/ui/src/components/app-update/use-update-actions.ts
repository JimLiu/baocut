import { useCallback } from 'react';
import { ToastQueue } from '@react-spectrum/s2';
import { barrierTasks, restartAsk, retryAction, type BarrierTask, type UpdateAction } from '../../model/app-update.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useAppUpdate } from '../../state/app-update-store.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { useTasks } from '../../state/tasks-store.ts';
import { U, type UpdateStep } from './update-copy.ts';

/*
 * 更新的动作（设计稿 settings-update.jsx `act`）：关于页、rail 按钮打开的更新窗、toast 走同一套。检查、下载、取消、安装
 * 都是主进程的事，这里只转给宿主的 `updates` 面；「重启并更新」先过停止屏障（架构设计 §2.6）。
 */

const failed = (step: UpdateStep) => (error: unknown) =>
  ToastQueue.negative(U.failed(step, error instanceof Error ? error.message : String(error)), { timeout: 5000 });

/** 现在还在跑的后台任务（读两个 store 的当前值，不订阅）。 */
export function liveBarrierTasks(): BarrierTask[] {
  return barrierTasks(useJobs.getState().jobs, useTasks.getState().tasks, isJobLive);
}

/** 交给主进程安装：校验、换包、退出都在那边；从这里起不再等后台任务。 */
export function installNow(runtime: RuntimeSession): void {
  const updates = runtime.host.updates;
  if (!updates) return;
  useAppUpdate.getState().setWaiting(false);
  void updates.install().catch(failed('install'));
}

/** 「现在停止并安装」：先把在跑的 Agent 任务停掉、Job 取消掉，都有了回音再安装（停不掉的不拦安装，Runtime 退出时照样停）。 */
export async function stopAllAndInstall(runtime: RuntimeSession): Promise<void> {
  const tasks = liveBarrierTasks();
  await Promise.allSettled(
    tasks.map((task) => {
      if (!task.action) return Promise.resolve();
      return task.action.type === 'stop' ? runtime.stop(task.action.taskId) : runtime.cancelJob(task.action.jobId);
    }),
  );
  installNow(runtime);
}

/** 「重启并更新」：有后台任务在跑就打开停止屏障，没有就直接安装。 */
export function requestRestart(runtime: RuntimeSession): void {
  if (restartAsk(liveBarrierTasks())) useAppUpdate.getState().openBarrier();
  else installNow(runtime);
}

export function useUpdateActions(): (action: UpdateAction) => void {
  const runtime = useRuntime();
  return useCallback(
    (action: UpdateAction) => {
      const updates = runtime.host.updates;
      if (!updates) return;
      const store = useAppUpdate.getState();
      switch (action) {
        case 'check':
          void updates.check().catch(failed('check'));
          return;
        case 'download':
          void updates.download().catch(failed('download'));
          return;
        case 'cancel':
          void updates.cancel().catch(failed('cancel'));
          return;
        case 'restart':
          requestRestart(runtime);
          return;
        case 'retry': {
          const state = store.snapshot?.state;
          if (!state) return;
          const run = retryAction(state) === 'download' ? updates.download() : updates.check();
          void run.catch(failed('retry'));
          return;
        }
        case 'downloadPage':
          void updates.openDownloadPage().catch(failed('downloadPage'));
          return;
        case 'later':
          store.closeWindow();
          return;
        case 'stopWaiting':
          store.setWaiting(false);
          return;
        case 'install':
          return;
      }
    },
    [runtime],
  );
}
