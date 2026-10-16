import { useCallback } from 'react';
import { ToastQueue } from '@react-spectrum/s2';
import { TASK_VIEW_COPY } from '../../copy.ts';
import type { TaskAction, TaskKind } from '../../model/task-list.ts';
import { cancelAgentSetup } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { CARD_COPY } from '../settings/agent-card-copy.ts';

/**
 * 停止 Agent 任务走 `tasks.stop`，取消 Job 走 `jobs.cancel`，停止 Agent 安装、升级走 `agents.cancelSetup`；
 * 失败时提示，不改本地状态（等主题事件）。
 */
export function useTaskAction(): (action: TaskAction) => void {
  const runtime = useRuntime();
  return useCallback(
    (action: TaskAction) => {
      if (action.type === 'stop') {
        runtime.stop(action.taskId).catch((e: Error) => ToastQueue.negative(TASK_VIEW_COPY.stopFailed(e.message), { timeout: 5000 }));
      } else if (action.type === 'cancelSetup') {
        cancelAgentSetup(runtime, action.runId).catch((e: Error) => ToastQueue.negative(CARD_COPY.stopFailed(e.message), { timeout: 5000 }));
      } else {
        runtime.cancelJob(action.jobId).catch((e: Error) => ToastQueue.negative(TASK_VIEW_COPY.cancelFailed(e.message), { timeout: 5000 }));
      }
    },
    [runtime],
  );
}

/** 列表与胶囊上那颗按钮的字：Agent 任务与 Agent 安装「停止」，Job「取消」。 */
export function actionLabel(action: TaskAction): string {
  return action.type === 'cancel' ? TASK_VIEW_COPY.cancel : TASK_VIEW_COPY.stop;
}

/** 详情页的大按钮（原型 page-tasks.jsx「取消任务 / 取消导出」）。 */
export function actionTitle(action: TaskAction, kind: TaskKind): string {
  if (action.type === 'stop' || action.type === 'cancelSetup') return TASK_VIEW_COPY.stopTask;
  return kind === 'export' ? TASK_VIEW_COPY.cancelExport : TASK_VIEW_COPY.cancelTask;
}
