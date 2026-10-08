import { useCallback, useEffect, useState } from 'react';
import type { JobRecord, ModelBundleStatus } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { checkRoute, checkState, repairOutcome, type CheckAbilities, type CheckState } from '../../model/model-check.ts';
import type { CheckSubject } from '../../model/model-check-copy.ts';
import { bundleActions, problemText, rpcProblem } from '../../model/models-install.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useModelCheck } from '../../state/model-check-store.ts';
import { stopInstall } from './local-model-actions.ts';
import { LOCAL_INSTALL_COPY as INSTALL } from './local-models-copy.ts';
import { startCheck } from './start-check.ts';

export interface BundleCheck {
  state: CheckState;
  can: CheckAbilities;
  /** 提交检查的请求还没回来。 */
  starting: boolean;
  /** 检查（被停用的先重新启用）；被拒时记下，写在状态行上，不弹 toast。 */
  start: () => Promise<void>;
  /** 取消检查（任务取消）或修复（停下并丢掉这次下载的部分），状态回到之前那条。 */
  cancel: () => void;
  /** 修复对话框提交了任务：记下来，修完自动再检查。 */
  repairStarted: (jobId: string) => void;
}

/**
 * 一行模型包的「检查」（model/model-check.ts）：状态从 `jobs` / `models` 主题算；提交被拒与这一行发起的修复记在
 * state/model-check-store.ts。修复任务完成后自动再检查一次；失败、取消或被打断就不检查，原因照常写在行上。
 * `ownFiles`：模型包自己的文件在盘上（`bundleActions` 的同名参数），权重在、缺组件的也能修复。
 */
export function useBundleCheck(
  bundle: ModelBundleStatus,
  subject: CheckSubject,
  jobs: readonly JobRecord[],
  ownFiles: boolean,
): BundleCheck {
  const runtime = useRuntime();
  const id = bundle.bundleId;
  const rejection = useModelCheck((s) => s.rejections[id] ?? null);
  const repairJobId = useModelCheck((s) => s.repairs[id] ?? null);
  const [starting, setStarting] = useState(false);
  const state = checkState({ bundle, jobs, subject, rejection, repairJobId });
  const route = checkRoute(bundle);
  const can: CheckAbilities = { repair: bundleActions(bundle, ownFiles).repair && state.phase !== 'repairing', recheck: route !== null };

  const start = useCallback(async () => {
    setStarting(true);
    try {
      await startCheck(runtime, id);
    } finally {
      setStarting(false);
    }
  }, [runtime, id]);

  const repairEnd = repairOutcome(jobs, repairJobId);
  useEffect(() => {
    // 只认还记着的那一次：同一个结束只触发一次检查（开发模式下 effect 会跑两遍）。
    const store = useModelCheck.getState();
    if (!repairEnd || !repairJobId || store.repairs[id] !== repairJobId) return;
    store.setRepair(id, null);
    if (repairEnd === 'check') void start();
  }, [repairEnd, repairJobId, id, start]);

  const cancel = () => {
    if (state.phase === 'checking') {
      runtime.cancelJob(state.jobId).catch((e: Error) => ToastQueue.negative(INSTALL.stopFailed(e.message), { timeout: 5000 }));
    } else if (state.phase === 'repairing') {
      useModelCheck.getState().setRepair(id, null);
      stopInstall(runtime, id, true).catch((e: unknown) =>
        ToastQueue.negative(INSTALL.stopFailed(problemText(rpcProblem(e))), { timeout: 8000 }),
      );
    }
  };

  const repairStarted = (jobId: string) => useModelCheck.getState().setRepair(id, jobId);

  return { state, can, starting, start, cancel, repairStarted };
}
