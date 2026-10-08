import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JobKind, JobRecord } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { rejectionRemedy } from '../../model/task-facts.ts';
import { reconcileOptions } from '../../model/task-reconcile.ts';
import { liveCount, toolJobs } from '../../model/tools-records.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useJobs } from '../../state/jobs-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { RECORD_COPY } from './tools-copy.ts';

/** 这类工具的记录：`jobs` 主题里这台电脑的界面提交的、不属于视频的任务，去掉本机藏起来的。`all` 给排队位次用。 */
export function useToolRecords(kind: JobKind): { ready: boolean; list: JobRecord[]; all: JobRecord[]; live: number } {
  const ready = useJobs((s) => s.ready);
  const all = useJobs((s) => s.jobs);
  const hidden = useTools((s) => s.hidden);
  const list = useMemo(() => toolJobs(all, kind, hidden), [all, kind, hidden]);
  return { ready, list, all, live: liveCount(list) };
}

/** 取消一条在跑或排队的记录（`jobs.cancel`）；结果等主题事件，失败时提示。 */
export function useCancelJob(): (jobId: string) => void {
  const runtime = useRuntime();
  return useCallback(
    (jobId: string) => {
      runtime.cancelJob(jobId).catch((e: Error) => ToastQueue.negative(RECORD_COPY.cancelFailed(e.message), { timeout: 5000 }));
    },
    [runtime],
  );
}

/**
 * 提交被拒时的提示：配置缺失（`CAPABILITY_NOT_CONFIGURED`）时写 Runtime 给的那句提示，并带去处按钮；其余照原因写。
 */
export function useSubmitFailed(kind: JobKind, text: (message: string) => string): (error: Error) => void {
  const go = useShell((s) => s.go);
  return useCallback(
    (error: Error) => {
      const remedy = rejectionRemedy(kind, error);
      if (!remedy) {
        ToastQueue.negative(text(error.message), { timeout: 6000 });
        return;
      }
      // 带按钮的提示不自动消失（S2 的无障碍要求）。
      ToastQueue.negative(text(remedy.hint || error.message), {
        actionLabel: remedy.label,
        onAction: () => go(remedy.target),
        shouldCloseOnAction: true,
      });
    },
    [go, kind, text],
  );
}

/**
 * 没做成的记录「再试一次 / 重新排队」。中断了、Runtime 认可就地重跑的，走 `jobs.reconcile` retry（同一个任务再排队，不另建）；
 * 其余照冻结的参数重新提交一个新任务（`resubmit` 返回 null 表示参数不全、提交不了）。在途时 `pending`；
 * 重新提交成功后这条记下 `done`、不再给按钮——连点或回头再点都不会多扣一次钱。结果不明的不在这里处理，去任务详情对账。
 */
export function useRecordRetry(
  job: JobRecord,
  kind: JobKind,
  resubmit: (job: JobRecord) => Promise<unknown> | null,
  copy: { submitted: string; failed: (message: string) => string },
): { retry: () => void; pending: boolean; done: boolean } {
  const runtime = useRuntime();
  const done = useTools((s) => s.retried.includes(job.jobId));
  const markRetried = useTools((s) => s.markRetried);
  const failed = useSubmitFailed(kind, copy.failed);
  const [pending, setPending] = useState(false);
  const inPlace = reconcileOptions(job).includes('retry') && job.state === 'interrupted';
  const retry = () => {
    if (pending || done) return;
    const request = inPlace ? runtime.reconcileJob(job.jobId, 'retry') : resubmit(job);
    if (!request) return;
    setPending(true);
    request
      .then(() => {
        if (!inPlace) markRetried(job.jobId);
        ToastQueue.positive(copy.submitted, { timeout: 3000 });
      }, failed)
      .finally(() => setPending(false));
  };
  return { retry, pending, done };
}

export type MediaUrl = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'failed'; message: string };

/**
 * 产物的受限地址（`artifacts.openHandle`）：给 `<audio>` / `<img>`。句柄一小时有效、每次读取续期，页面开着时够用；
 * 每个卡片挂载时取一次。
 */
export function useArtifactUrl(artifactId: string | null): MediaUrl | null {
  const runtime = useRuntime();
  const [state, setState] = useState<{ id: string; media: MediaUrl } | null>(null);
  useEffect(() => {
    if (!artifactId) return;
    let live = true;
    runtime.openArtifact(artifactId).then(
      (handle) => live && setState({ id: artifactId, media: { status: 'ready', url: handle.url } }),
      (e: Error) => live && setState({ id: artifactId, media: { status: 'failed', message: e.message } }),
    );
    return () => {
      live = false;
    };
  }, [runtime, artifactId]);
  if (!artifactId) return null;
  return state?.id === artifactId ? state.media : { status: 'loading' };
}

/**
 * 下载一个产物：取受限地址、读成 Blob、用 `<a download>` 交给浏览器（桌面端走系统的下载）。地址读不成 Blob 时
 * 退回在新窗口里打开。失败原样抛出。
 */
export function useDownloadArtifact(): (artifactId: string, fileName: string) => Promise<void> {
  const runtime = useRuntime();
  return useCallback(
    async (artifactId: string, fileName: string) => {
      const handle = await runtime.openArtifact(artifactId);
      let href: string;
      let revoke = false;
      try {
        const response = await fetch(handle.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        href = URL.createObjectURL(await response.blob());
        revoke = true;
      } catch {
        window.open(handle.url, '_blank', 'noopener');
        return;
      }
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(href), 60_000);
    },
    [runtime],
  );
}

/** 复制一段文字，成败都提示。 */
export function copyText(text: string): void {
  navigator.clipboard.writeText(text).then(
    () => ToastQueue.positive(RECORD_COPY.copied, { timeout: 3000 }),
    () => ToastQueue.negative(RECORD_COPY.copyFailed, { timeout: 4000 }),
  );
}
