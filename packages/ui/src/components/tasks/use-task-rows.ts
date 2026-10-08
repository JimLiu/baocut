import { useMemo } from 'react';
import { taskRows, type OpenVideoFacts, type TaskRow, type TaskRowsOptions } from '../../model/task-list.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useTasks } from '../../state/tasks-store.ts';
import { useVideo } from '../../state/video-store.ts';

/** 编辑器打开的视频里给任务表用的几样：名字、所在项目、素材名。 */
export function useOpenVideoFacts(): OpenVideoFacts | null {
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const name = useVideo((s) => s.video?.state?.video.name ?? s.video?.ref?.name ?? null);
  const projectId = useVideo((s) => s.video?.ref?.source.projectId ?? null);
  const assets = useVideo((s) => s.video?.state?.video.assets);
  return useMemo(
    () => (videoId && name ? { videoId, name, projectId, assets: assets ?? {} } : null),
    [videoId, name, projectId, assets],
  );
}

/** 后台任务的统一表：Agent 任务与 Job，后起的在前。任务页、侧栏与任务胶囊共用。 */
export function useTaskRows(options: TaskRowsOptions = {}): { rows: TaskRow[]; ready: boolean } {
  const fold = options.fold ?? true;
  const tasks = useTasks((s) => s.tasks);
  const jobs = useJobs((s) => s.jobs);
  const tasksReady = useTasks((s) => s.ready);
  const jobsReady = useJobs((s) => s.ready);
  const projects = useDirectory((s) => s.projects);
  const conversations = useDirectory((s) => s.conversations);
  const video = useOpenVideoFacts();
  const rows = useMemo(
    () => taskRows(tasks, jobs, { projects, conversations, video }, { fold }),
    [tasks, jobs, projects, conversations, video, fold],
  );
  return { rows, ready: tasksReady && jobsReady };
}
