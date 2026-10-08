import {
  newId,
  type AgentMode,
  type AgentPolicy,
  type AgentSetupAction,
  type AgentSetupRun,
  type AgentsView,
  type DriverId,
  type DriverInstallOption,
  type Id,
  type ModelCapabilitiesView,
  type ProviderView,
} from '@baocut/protocol';
import { useAgentSetup } from '../state/agent-setup-store.ts';
import { useConnection } from '../state/connection-store.ts';
import { useModels } from '../state/models-store.ts';
import { useSettings } from '../state/settings-store.ts';
import type { RuntimeSession } from './session.ts';

/**
 * 设置 › Agent 提供方的命令（`agents.*`）。每一条都返回完整的 `AgentsView`，拿到就整份写回连接镜像，
 * 界面不在本地改 Agent 状态。和 `RuntimeSession` 的其他命令一样走它的连接，只是单独成文件，免得设置页的命令把会话通道撑大。
 */
async function apply(view: Promise<AgentsView>): Promise<AgentsView> {
  const result = await view;
  useConnection.getState().setAgents(result);
  return result;
}

/** 「重新检测」：不用缓存，重新探测安装、版本、登录，并刷新模型表。 */
export function detectAgents(session: RuntimeSession, driverId?: DriverId): Promise<AgentsView> {
  return apply(session.client.request('agents.detect', driverId ? { driverId } : {}));
}

/**
 * 启用或停用、默认模型与强度、手动指定的可执行文件（null 取消指定，回到自动查找）。
 * 只改 `defaultModel` 不带 `defaultEffort` 时，Runtime 会把强度清回模型默认。
 */
export function configureAgent(
  session: RuntimeSession,
  driverId: DriverId,
  patch: { enabled?: boolean; defaultModel?: string | null; defaultEffort?: string | null; executable?: string | null },
): Promise<AgentsView> {
  return apply(session.client.request('agents.configure', { driverId, ...patch }));
}

export function setDefaultAgent(session: RuntimeSession, driverId: DriverId): Promise<AgentsView> {
  return apply(session.client.request('agents.setDefault', { driverId }));
}

/**
 * 添加一个说 ACP 的智能体（目录条目或自定义命令，产品设计 §7.6）。Runtime 存下它、注册成 Driver 并在后台探测：
 * 刚返回时它多半还在 `checking` 里，探测结果经 `agents` 主题送达。id 重名以 `conflict`（`details.code: 'AGENT_PROVIDER_EXISTS'`）拒绝。
 * 浏览器会话不能调用（不在 Web 白名单里）。
 */
export function addAgentProvider(
  session: RuntimeSession,
  provider: { id: DriverId; name: string; command: string[]; env?: Record<string, string> },
): Promise<AgentsView> {
  return apply(session.client.request('agents.addProvider', { ...provider, commandId: newId('cmd') }));
}

/** 移除一个用户添加的智能体：连同它的探测缓存、启用状态与默认模型偏好；内置的不能移除（用 `configureAgent` 停用）。 */
export function removeAgentProvider(session: RuntimeSession, id: DriverId): Promise<AgentsView> {
  return apply(session.client.request('agents.removeProvider', { id }));
}

export function updateAgentPreferences(
  session: RuntimeSession,
  patch: { policy?: Partial<AgentPolicy>; modelAutoUpdate?: boolean },
): Promise<AgentsView> {
  return apply(session.client.request('agents.updatePreferences', patch));
}

export function removeAgentRule(session: RuntimeSession, rule: string): Promise<AgentsView> {
  return apply(session.client.request('agents.removeRule', { rule }));
}

/**
 * 新会话的默认访问模式（设置 `agent.defaultAccessMode`，§3.12）。没切过访问模式的会话也跟着它走。
 * 返回的快照先写进 `useSettings`，`settings` 主题随后推的变化是同一个值。
 */
export async function setDefaultAccessMode(session: RuntimeSession, mode: AgentMode): Promise<void> {
  const snapshot = await session.client.request('settings.set', { values: { 'agent.defaultAccessMode': mode } });
  useSettings.getState().replace(snapshot);
}

// ---- 安装、升级与登录（架构设计 §12.9）：命令都由 Runtime 从探测结果里取，这里只说哪个 Agent、做什么、哪种方式 ----

/**
 * 在设置页里运行安装或升级命令（只有 brew、npm 类；用户在确认框里看过完整命令之后才调）。
 * 返回刚登记的那次运行；之后的输出与结果经 `agent-setup` 主题送达（`watchAgentSetup`）。
 */
export async function runAgentSetup(
  session: RuntimeSession,
  driverId: DriverId,
  action: AgentSetupAction,
  kind: DriverInstallOption['kind'],
): Promise<AgentSetupRun> {
  const { run } = await session.client.request('agents.runSetup', { driverId, action, kind, commandId: newId('cmd') });
  // 主题事件可能先到（那时已经带着输出），只在镜像里还没有这次时补上，免得用空输出盖掉。
  const store = useAgentSetup.getState();
  if (!store.runs.some((r) => r.runId === run.runId)) store.apply({ type: 'setup.updated', run });
  return run;
}

export async function cancelAgentSetup(session: RuntimeSession, runId: Id): Promise<void> {
  await session.client.request('agents.cancelSetup', { runId });
}

/**
 * 在系统终端里运行登录、安装或升级命令（要交互、要密码、或是官方脚本的）。
 * `unsupported`（这台电脑上打不开终端）时结果里带着命令，调用方退回复制。
 */
export function openAgentTerminal(
  session: RuntimeSession,
  driverId: DriverId,
  action: 'login' | AgentSetupAction,
  kind?: DriverInstallOption['kind'],
): Promise<{ status: 'opened' | 'unsupported'; command: string }> {
  return session.client.request('agents.openTerminal', kind ? { driverId, action, kind } : { driverId, action });
}

/**
 * 订阅 `agent-setup` 主题，写进 `useAgentSetup`；返回取消订阅（同时清空镜像）。只在 Agent 提供方页签挂着时订阅。
 *
 * 一次运行到终态时，Runtime 已经重新探测过：先读 `agents.list` 写回连接镜像，再把终态交给界面，
 * 这样界面看到「已完成」时版本、登录状态已经是新的；`onFinished` 在这之后调用（成功的 toast 用它）。
 * `agents` 主题也会推新视图，但协议不保证它先于 `agent-setup` 的终态到达，所以这里仍主动读一次。
 * 快照与事件按到达顺序串行处理，读列表的那一下不会让后到的事件抢先。
 */
export function watchAgentSetup(session: RuntimeSession, onFinished?: (run: AgentSetupRun, view: AgentsView | null) => void): () => void {
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (step: () => Promise<void> | void) => {
    queue = queue.then(step).catch(() => {});
  };
  const unsubscribe = session.client.subscribeAgentSetup({
    snapshot: (snapshot) => enqueue(() => {
      if (!stopped) useAgentSetup.getState().replace(snapshot);
    }),
    event: (event) =>
      enqueue(async () => {
        if (stopped) return;
        const finished = event.type === 'setup.updated' && event.run.state !== 'running' ? event.run : null;
        const wasRunning = finished ? useAgentSetup.getState().runs.find((r) => r.runId === finished.runId)?.state === 'running' : false;
        const view = finished ? await apply(session.client.request('agents.list', {})).catch(() => null) : null;
        if (stopped) return;
        useAgentSetup.getState().apply(event);
        // 只对这次订阅里看着它跑完的那次回调；重连后补发的旧终态不再弹一遍。
        if (finished && wasRunning) onFinished?.(finished, view);
      }),
  });
  return () => {
    stopped = true;
    unsubscribe();
    useAgentSetup.getState().reset();
  };
}

// ---- 用 Codex 画图（图片生成的智能体 Provider `agent:codex`，架构设计 §6.9）：开关在 Codex 卡上，状态是模型服务的视图 ----

/**
 * 探测一次模型能力（`models.capabilities`：会问 Driver 与节点，最多约 2 秒），结果写进 `useModels`。
 * 视图没变时 `models` 主题不推事件，所以这里自己写一下。
 */
export async function probeModelCapabilities(session: RuntimeSession): Promise<ModelCapabilitiesView> {
  const { capabilities } = await session.client.request('models.capabilities', {});
  useModels.getState().apply({ type: 'capabilities.updated', capabilities });
  return capabilities;
}

/** 打开或关闭一个智能体 Provider（只有开关）。新视图经 `models` 主题送达 `useModels`，这里不另写。 */
export async function setAgentProviderEnabled(session: RuntimeSession, providerId: string, enabled: boolean): Promise<ProviderView> {
  const { provider } = await session.client.request('models.configure', { providerId, enabled });
  return provider;
}
