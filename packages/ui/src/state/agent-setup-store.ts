import { create } from 'zustand';
import { applyAgentSetupEvent } from '@baocut/client';
import type { AgentSetupEvent, AgentSetupRun, AgentSetupSnapshot, Id } from '@baocut/protocol';

/**
 * 在应用内运行的 Agent 安装、升级命令（`agent-setup` 主题）的镜像：设置 › Agent 提供方与首次启动引导都会运行，
 * 外壳根上的 AgentSetupHost 一直订阅着（`watchAgentSetup`）；Agent 提供方的日志框与后台任务里的那一行读这里。
 *
 * `shown`：这次订阅里见过「运行中」的那几次。日志框与后台任务只给它们（以及正在运行的）显示——Runtime 在内存里留着最近
 * 20 次，打开应用之前就跑完的那几次不再挂出来。
 */
export interface AgentSetupStore {
  ready: boolean;
  runs: AgentSetupRun[];
  shown: ReadonlySet<Id>;
  replace(snapshot: AgentSetupSnapshot): void;
  apply(event: AgentSetupEvent): void;
  reset(): void;
}

function withLive(shown: ReadonlySet<Id>, runs: readonly AgentSetupRun[]): ReadonlySet<Id> {
  const live = runs.filter((run) => run.state === 'running' && !shown.has(run.runId));
  return live.length ? new Set([...shown, ...live.map((run) => run.runId)]) : shown;
}

export const useAgentSetup = create<AgentSetupStore>()((set) => ({
  ready: false,
  runs: [],
  shown: new Set(),
  replace: (snapshot) => set((s) => ({ ready: true, runs: snapshot.runs, shown: withLive(s.shown, snapshot.runs) })),
  apply: (event) =>
    set((s) => {
      const { runs } = applyAgentSetupEvent(s, event);
      return { runs, shown: withLive(s.shown, runs) };
    }),
  reset: () => set({ ready: false, runs: [], shown: new Set() }),
}));
