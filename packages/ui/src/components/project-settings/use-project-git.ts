import { useCallback, useEffect, useState } from 'react';
import type { Id, ProjectGitStatus } from '@baocut/protocol';
import { commitText, gitError } from '../../model/project-git.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useProjectSettings } from '../../state/project-settings-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useAlive } from '../use-alive.ts';
import { PROJECT_SETTINGS_COPY as C } from './project-settings-copy.ts';

/** 一次操作的结果。项目设置与版本记录都是模态对话框，toast 落在遮罩下面点不到，所以结果写在原地。 */
export interface GitNote {
  tone: 'positive' | 'informative' | 'notice' | 'negative';
  title: string;
  text: string;
}

/**
 * 项目的 git 状态：挂上时读一次（`projects.git.status` 不推送），读不到记在 `loadError`；`reload` 再读，失败时抛出，由调用方写在原地。
 * 状态记在共用的 store 里。
 */
export function useProjectGit(projectId: Id): { status: ProjectGitStatus | null; loadError: string | null; reload(): Promise<ProjectGitStatus> } {
  const runtime = useRuntime();
  const status = useProjectSettings((s) => s.statuses[projectId] ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const alive = useAlive();
  const reload = useCallback(async () => {
    const { status: next } = await runtime.client.request('projects.git.status', { projectId });
    useProjectSettings.getState().put(next);
    if (alive.current) setLoadError(null);
    return next;
  }, [runtime, projectId, alive]);
  useEffect(() => {
    reload().catch((error: unknown) => {
      if (alive.current) setLoadError(gitError(error).message);
    });
  }, [reload, alive]);
  return { status, loadError, reload };
}

/** 「提交到 git」：结果交给 `onDone`；拒绝时 Runtime 带回的新状态照样记下。 */
export function useGitCommit(projectId: Id, onDone: (note: GitNote) => void): { busy: boolean; commit(): void } {
  const runtime = useRuntime();
  const [busy, setBusy] = useState(false);
  const alive = useAlive();
  const commit = useCallback(() => {
    setBusy(true);
    void runtime.client
      .request('projects.git.commit', { projectId })
      .then((result) => {
        useProjectSettings.getState().put(result.status);
        const text = commitText(result, videoName);
        if (alive.current) onDone(result.committed ? { tone: 'positive', title: C.committedTitle, text } : { tone: 'informative', title: C.nothingTitle, text });
      })
      .catch((error: unknown) => {
        const reason = gitError(error);
        if (reason.status) useProjectSettings.getState().put(reason.status);
        if (alive.current) onDone({ tone: 'negative', title: C.commitFailed, text: reason.message });
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
  }, [runtime, projectId, onDone, alive]);
  return { busy, commit };
}

/** 提交结果里的视频 ID 换成名字：Space 目录里的视频条目（显示名）；找不到时 null。 */
function videoName(videoId: Id): string | null {
  const entry = useSpace.getState().entries.find((e) => e.kind === 'video' && e.ref && 'videoId' in e.ref && e.ref.videoId === videoId);
  return entry?.name ?? null;
}
