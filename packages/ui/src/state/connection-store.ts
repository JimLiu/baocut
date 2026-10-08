import { create } from 'zustand';
import type { ConnectionState } from '@baocut/client';
import type { AgentPreferences, AgentsView, DriverId, DriverInfo } from '@baocut/protocol';

/** 与 Runtime 的连接与能力快照（架构设计 §3.6）。 */
export interface ConnectionStore {
  state: ConnectionState;
  /** 每个 Driver 最近一次的探测结果（启动时来自 Runtime 的磁盘缓存）；null = 还没拿到 `agents` 主题的快照。 */
  drivers: DriverInfo[] | null;
  /** 还没有任何探测结果、正在首次探测的 Driver（不在 `drivers` 里）。 */
  checking: DriverId[];
  /** Agent 偏好（默认 Agent、默认模型、上次的访问模式、放行策略与规则）。 */
  agentPreferences: AgentPreferences | null;
  setState(state: ConnectionState): void;
  setAgents(view: AgentsView): void;
}

export const useConnection = create<ConnectionStore>()((set) => ({
  state: { status: 'connecting', attempt: 0 },
  drivers: null,
  checking: [],
  agentPreferences: null,
  setState: (state) => set({ state }),
  setAgents: (view) => set({ drivers: view.drivers, checking: view.checking, agentPreferences: view.preferences }),
}));

/**
 * 新会话默认用的 Agent。结果里没有标默认的那个、又有 Driver 还在首次探测时，默认的多半就在检测中：
 * 返回 null（显示「正在检测」），不拿第一个顶上，免得悄悄换成另一个 Agent。
 */
export function defaultDriver(drivers: readonly DriverInfo[] | null, checking: readonly DriverId[]): DriverInfo | null {
  const marked = drivers?.find((d) => d.isDefault);
  if (marked) return marked;
  return checking.length ? null : (drivers?.[0] ?? null);
}
