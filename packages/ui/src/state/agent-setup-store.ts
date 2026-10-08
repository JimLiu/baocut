import { create } from 'zustand';
import { applyAgentSetupEvent } from '@baocut/client';
import type { AgentSetupEvent, AgentSetupRun, AgentSetupSnapshot, Id } from '@baocut/protocol';

/**
 * 设置页里运行的 Agent 安装、升级命令（`agent-setup` 主题）的镜像。只在 Agent 提供方页签打开时订阅（`watchAgentSetup`），
 * 离开就清空。
 *
 * `shown`：这次订阅里见过「运行中」的那几次。日志框只给它们（以及正在运行的）显示——Runtime 在内存里留着最近 20 次，
 * 早先跑完的那次不再挂在命令下面（设计稿 useCmdRun 的运行状态由卡片持有，离开页面就没了）。
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
