import { useAppUpdate } from '../../state/app-update-store.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { isLive, useTasks } from '../../state/tasks-store.ts';

/** 在等后台任务结束后安装时，还有几个在跑；没在等时 null。 */
export function useWaitingCount(): number | null {
  const waiting = useAppUpdate((s) => s.waiting);
  const running = useTasks((s) => s.tasks.filter(isLive).length) + useJobs((s) => s.jobs.filter(isJobLive).length);
  return waiting ? running : null;
}
