import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriverId } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { agentJobStatus, shouldShowOnboarding, type AgentInstallJob } from '../../model/onboarding.ts';
import { runAgentSetup } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useAgentSetup } from '../../state/agent-setup-store.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useLegacyImport } from '../../state/legacy-import-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useOnboarding } from '../../state/onboarding-store.ts';
import { CARD_COPY } from '../settings/agent-card-copy.ts';
import { OnboardingDialog } from './onboarding-dialog.tsx';

/**
 * 首次启动引导（产品设计 §7.6；设计稿 onboarding.jsx）：挂在外壳根上、`LegacyImportHost` 后面。第一次打开桌面应用时弹一次
 * （从没有引导的旧版升级上来的也弹一次），走完、跳过最后一步、「退出引导」或 Esc 都记下，以后不再弹。
 * 等连上 Runtime、本机模型的状态与 Agent 的探测结果到了，旧版项目导入的询问（和设置迁移报告）答完再弹，免得两个对话框叠在一起。
 * Web 不弹：浏览器里不能安装本机模型与 Agent（`models.install*`、`agents.runSetup` 不在 Web 白名单里）。
 *
 * 引导里勾上的 Agent 在这里排队安装：引导关掉之后队列照样往下走，运行状态与输出在 `agent-setup` 主题（AgentSetupHost）。
 */
export function OnboardingHost() {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const record = useOnboarding((s) => s.record);
  const connected = useConnection((s) => s.state.status === 'connected');
  const modelsReady = useModels((s) => s.ready);
  // 第一步列这台电脑上的 Agent：等第一份探测结果到了再弹，免得一打开是空列表、一点「下一步」就跳过了。
  const agentsReady = useConnection((s) => s.drivers !== null);
  const legacyReady = useLegacyImport((s) => s.ready);
  const legacyAsking = useLegacyImport((s) => s.asking);
  const reportOpen = useLegacyImport((s) => s.settingsReportOpen);
  const [open, setOpen] = useState(false);
  const due = !web && shouldShowOnboarding(record);

  useEffect(() => {
    if (open || !due || !connected || !modelsReady || !agentsReady || !legacyReady || legacyAsking || reportOpen) return;
    // 询问是 LegacyImportHost 在 effect 里记下的；它挂在前面，effect 先跑，这里读到的已经是这次渲染之后的。
    if (useLegacyImport.getState().asking) return;
    setOpen(true);
  }, [open, due, connected, modelsReady, agentsReady, legacyReady, legacyAsking, reportOpen]);

  const [jobs, setJobs] = useState<AgentInstallJob[]>([]);
  const runs = useAgentSetup((s) => s.runs);
  const starting = useRef(false);
  const patch = useCallback((driverId: DriverId, change: Partial<AgentInstallJob>) => {
    setJobs((list) => list.map((j) => (j.driverId === driverId && !j.runId && !j.failed ? { ...j, ...change } : j)));
  }, []);
  useEffect(() => {
    if (starting.current || jobs.some((j) => j.runId && agentJobStatus(j, runs) === 'running')) return;
    const next = jobs.find((j) => !j.runId && !j.failed);
    if (!next) return;
    starting.current = true;
    runAgentSetup(runtime, next.driverId, 'install', next.kind).then(
      (run) => {
        starting.current = false;
        patch(next.driverId, { runId: run.runId });
      },
      (error: unknown) => {
        starting.current = false;
        patch(next.driverId, { failed: true });
        ToastQueue.negative(`${next.name} · ${CARD_COPY.runFailed((error as Error).message)}`, { timeout: 5000 });
      },
    );
  }, [jobs, runs, runtime, patch]);
  // 没装成的再勾上是重新排队：去掉上一次的那一条。
  const enqueue = useCallback((add: readonly Omit<AgentInstallJob, 'runId' | 'failed'>[]) => {
    setJobs((list) => [
      ...list.filter((j) => !add.some((a) => a.driverId === j.driverId)),
      ...add.map((a) => ({ ...a, runId: null, failed: false })),
    ]);
  }, []);

  if (!open || !due) return null;
  return <OnboardingDialog agentJobs={jobs} onInstallAgents={enqueue} />;
}
