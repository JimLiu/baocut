import { useEffect, useRef, useState } from 'react';
import type { ExternalToolStatus } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { M } from '../../model/tools-image-edit-copy.ts';
import { rejectionText } from '../../model/tools-transcode.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useJobs } from '../../state/jobs-store.ts';
import { invalidateToolStatus } from './use-tool-status.ts';

export type ManagedToolsState = {
  state: 'ready' | 'missing' | 'checking';
  /** 第一个没装好的工具的名字（执行的程序在前、权重包在后，一次装一个）；都装好时 null。 */
  missing: string | null;
  /** 它的现状；检测失败时 null。 */
  tool: ExternalToolStatus | null;
  recheck: () => void;
  installing: boolean;
  install: () => void;
};

/**
 * 一组受管外部工具（放大的模型要的执行程序与权重包）：检测装没装；没装时这一页给下载卡（来源、版本、大小、许可），点了才下。
 * 换了一组（换了模型）就重新检测，晚到的旧结果丢掉。同一组从没装变成装好时重读 `tools.list`（同 `useRefreshWhenReady`）：
 * 页头的拦截与提交按钮跟的是那份现状，不重读要刷新页面才解开。
 */
export function useManagedTools(names: readonly string[], enabled: boolean): ManagedToolsState {
  const runtime = useRuntime();
  const key = enabled ? names.join('\n') : '';
  const [found, setFound] = useState<{ key: string; tools: Array<ExternalToolStatus | null> } | null>(null);
  const [installing, setInstalling] = useState(false);
  const seq = useRef(0);
  const jobs = useJobs((s) => s.jobs);
  const recheck = () => {
    const n = ++seq.current;
    const list = key ? key.split('\n') : [];
    void Promise.all(list.map((name) => runtime.detectExternalTool(name).catch(() => null))).then((tools) => {
      if (n === seq.current) setFound({ key, tools });
    });
  };
  useEffect(() => {
    if (key) recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = found?.key === key ? found.tools : null;
  const at = current ? current.findIndex((t) => t?.state !== 'installed') : -1;
  const tool = at >= 0 ? (current![at] ?? null) : null;
  const missing = at >= 0 ? key.split('\n')[at]! : null;
  // 安装任务结束后再查一次。
  const installJob = tool?.installJobId ? jobs.find((j) => j.jobId === tool.installJobId) : null;
  const installDone = installJob ? installJob.endedAt !== null : false;
  useEffect(() => {
    if (installDone) recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installDone]);
  const install = () => {
    if (!missing) return;
    const label = tool?.label ?? missing;
    setInstalling(true);
    runtime
      .installExternalTool(missing)
      .then(
        (result) => {
          setFound((f) => (f && f.key === key ? { key, tools: f.tools.map((t, i) => (i === at ? result.tool : t)) } : f));
          ToastQueue.neutral(M.toolInstalling(label), { timeout: 3000 });
        },
        (e: unknown) => ToastQueue.negative(M.toolInstallFailed(label, rejectionText(e)), { timeout: 8000 }),
      )
      .finally(() => setInstalling(false));
  };
  const state = !key ? 'ready' : !current ? 'checking' : missing ? 'missing' : 'ready';
  const wasMissing = useRef<string | null>(null);
  useEffect(() => {
    if (state === 'missing') wasMissing.current = key;
    else if (state === 'ready' && wasMissing.current === key && key) {
      wasMissing.current = null;
      invalidateToolStatus(runtime);
    }
  }, [state, key, runtime]);
  if (!key) return { state: 'ready', missing: null, tool: null, recheck, installing, install };
  return { state, missing, tool, recheck, installing: installing || !!tool?.installJobId, install };
}
