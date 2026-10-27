import { useEffect, useRef, useState } from 'react';
import type { ExternalToolStatus } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { M } from '../../model/tools-image-edit-copy.ts';
import { rejectionText } from '../../model/tools-transcode.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useJobs } from '../../state/jobs-store.ts';
import { invalidateToolStatus } from './use-tool-status.ts';

export const REALESRGAN = 'realesrgan-ncnn-vulkan';

export type EsrganState = { state: 'ready' | 'missing' | 'checking'; tool: ExternalToolStatus | null; recheck: () => void; installing: boolean; install: () => void };

/**
 * Real-ESRGAN（受管外部工具）：检测装没装；没装时这一页给下载卡（来源、版本、大小、许可），点了才下。
 * 从没装变成装好时重读 `tools.list`（同 `useRefreshWhenReady`）：页头的拦截与提交按钮跟的是那份现状，不重读要刷新页面才解开。
 */
export function useEsrgan(enabled: boolean): EsrganState {
  const runtime = useRuntime();
  const [tool, setTool] = useState<ExternalToolStatus | null>(null);
  const [checking, setChecking] = useState(enabled);
  const [installing, setInstalling] = useState(false);
  const jobs = useJobs((s) => s.jobs);
  const recheck = () => {
    setChecking(true);
    runtime.detectExternalTool(REALESRGAN).then(
      (t) => setTool(t),
      () => setTool(null),
    ).finally(() => setChecking(false));
  };
  useEffect(() => {
    if (enabled) recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  // 安装任务结束后再查一次。
  const installJob = tool?.installJobId ? jobs.find((j) => j.jobId === tool.installJobId) : null;
  const installDone = installJob ? installJob.endedAt !== null : false;
  useEffect(() => {
    if (installDone) recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installDone]);
  const install = () => {
    setInstalling(true);
    runtime.installExternalTool(REALESRGAN).then(
      (result) => {
        setTool(result.tool);
        ToastQueue.neutral(M.esrganInstalling, { timeout: 3000 });
      },
      (e: unknown) => ToastQueue.negative(M.esrganInstallFailed(rejectionText(e)), { timeout: 8000 }),
    ).finally(() => setInstalling(false));
  };
  const state = !enabled ? 'ready' : checking ? 'checking' : tool?.state === 'installed' ? 'ready' : 'missing';
  const wasMissing = useRef(false);
  useEffect(() => {
    if (state === 'missing') wasMissing.current = true;
    else if (state === 'ready' && wasMissing.current) {
      wasMissing.current = false;
      invalidateToolStatus(runtime);
    }
  }, [state, runtime]);
  if (!enabled) return { state: 'ready', tool: null, recheck, installing, install };
  return { state, tool, recheck, installing: installing || !!tool?.installJobId, install };
}
