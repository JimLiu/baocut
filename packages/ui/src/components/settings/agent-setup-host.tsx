import { useEffect } from 'react';
import { ToastQueue } from '@react-spectrum/s2';
import { watchAgentSetup } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { setupDoneToast } from './agent-setup.ts';

/**
 * 应用内运行的 Agent 安装、升级（`agent-setup` 主题）：挂在外壳根上，一直订阅。设置 › Agent 提供方与首次启动引导都会运行，
 * 离开那一页、关掉引导之后照样收输出与结果；成功跑完（Runtime 已重新检测）在哪儿都弹一句。Web 只看不运行，也照样订阅
 * （桌面端运行的输出在 Web 的设置页与后台任务里也看得到）。
 */
export function AgentSetupHost() {
  const runtime = useRuntime();
  useEffect(
    () =>
      watchAgentSetup(runtime, (run, view) => {
        const now = view?.drivers.find((d) => d.id === run.driverId);
        const toast = now ? setupDoneToast(run, now) : null;
        if (toast) ToastQueue[toast.tone](toast.text, { timeout: 4000 });
      }),
    [runtime],
  );
  return null;
}
