import { useRef } from 'react';
import { AlertDialog, DialogContainer } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { barrierTasks, restartAsk, type RestartAsk } from '../../model/app-update.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useAppUpdate } from '../../state/app-update-store.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { useTasks } from '../../state/tasks-store.ts';
import { stopAllAndInstall } from './use-update-actions.ts';

/*
 * 安装前的停止屏障（架构设计 §2.6；设计稿 settings-update.jsx `restart` 的确认）：点「重启并更新」时还有后台任务在跑，
 * 先问——「现在停止并安装」把 Agent 任务停掉、Job 取消掉再交给主进程安装；「等任务结束后安装」记下等待，任务都结束了
 * 自动安装；「稍后」什么都不做。停了之后仍可能在远端运行或计费的任务列在正文里。
 */

const para = style({ marginBottom: 0, marginTop: { default: 0, ':nth-child(n+2)': 12 } });
const list = style({ marginTop: 8, marginBottom: 0, paddingStart: 20 });
const item = style({ marginTop: { default: 0, ':nth-child(n+2)': 4 } });
const where = style({ color: 'gray-600' });

export function InstallBarrier() {
  const runtime = useRuntime();
  const open = useAppUpdate((s) => s.barrierOpen);
  const closeBarrier = useAppUpdate((s) => s.closeBarrier);
  const setWaiting = useAppUpdate((s) => s.setWaiting);
  const jobs = useJobs((s) => s.jobs);
  const tasks = useTasks((s) => s.tasks);
  // 列表跟着任务实时变；开着的时候任务恰好都结束了，留着上一次的内容，等用户自己选（不替他重启）。
  const last = useRef<RestartAsk | null>(null);
  const live = open ? restartAsk(barrierTasks(jobs, tasks, isJobLive)) : null;
  if (live) last.current = live;
  const ask = open ? (live ?? last.current) : null;
  return (
    <DialogContainer onDismiss={closeBarrier}>
      {ask ? (
        <AlertDialog
          variant="warning"
          title={ask.title}
          primaryActionLabel={ask.stopLabel}
          secondaryActionLabel={ask.waitLabel}
          cancelLabel={ask.cancelLabel}
          autoFocusButton="secondary"
          onPrimaryAction={() => void stopAllAndInstall(runtime)}
          onSecondaryAction={() => setWaiting(true)}>
          <p className={para}>{ask.body}</p>
          {ask.remoteTitle ? (
            <>
              <p className={para}>{ask.remoteTitle}</p>
              <ul className={list}>
                {ask.remote.map((task) => (
                  <li key={task.id} className={item}>
                    {task.title}
                    {task.where ? <span className={where}> · {task.where}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </AlertDialog>
      ) : null}
    </DialogContainer>
  );
}
