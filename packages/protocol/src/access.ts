import type { Autonomy, Id } from './domain.ts';
import type { GrantRequestItem } from './grants.ts';
import type { ServiceId, ServiceLevel } from './services.ts';
import { live } from './i18n.ts';
import type { Localized } from './message-ref.ts';
import { ProtocolLabels } from './messages/protocol/protocol-labels.ts';

/**
 * 访问模式与统一审批（架构设计 §3.12、§4.8）。
 *
 * - 四档访问模式决定会话里的动作要不要逐项确认；`plan`（先给方案）是独立的一档，不执行写操作。
 * - 每个动作带一个风险等级；访问模式（或对外服务的等级）× 风险等级查表得到「自动」「询问」或「拒绝」。
 * - 旧值仍被接受：`controlled` → `ask`，`authorized` → `fullAccess`，`plan` 不变（`normalizeAgentMode`）。
 */

/** 四档访问模式，从严到宽。 */
export const ACCESS_MODES = ['ask', 'autoAcceptEdits', 'auto', 'fullAccess'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

/** 会话的模式：四档访问模式，加上独立的「先给方案」。 */
export const AGENT_MODES = ['plan', ...ACCESS_MODES] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** 仍被接受的旧值（0.1 的自主模式）。 */
export const LEGACY_AGENT_MODES = ['controlled', 'authorized'] as const;

/** 新会话的默认模式（`agent.defaultAccessMode` 的默认值）。 */
export const DEFAULT_AGENT_MODE: AgentMode = 'auto';

/**
 * 给人看的名字（会话里的切换提示、CLI），带消息引用：嵌进 Runtime 的句子时把它作为参数传，界面能按自己的语言重新生成。
 */
export function agentModeLabel(mode: AgentMode): Localized {
  switch (mode) {
    case 'plan':
      return ProtocolLabels.modePlan();
    case 'ask':
      return ProtocolLabels.modeAsk();
    case 'autoAcceptEdits':
      return ProtocolLabels.modeAutoAcceptEdits();
    case 'auto':
      return ProtocolLabels.modeAuto();
    case 'fullAccess':
      return ProtocolLabels.modeFullAccess();
  }
}

/** 给人看的名字的当前语言文字（读的时候取当前语言）。 */
export const AGENT_MODE_LABELS: Readonly<Record<AgentMode, string>> = live(
  () => Object.fromEntries(AGENT_MODES.map((mode) => [mode, agentModeLabel(mode).text])) as Record<AgentMode, string>,
);

/** 旧值换成新值；新值原样返回。 */
export function normalizeAgentMode(mode: AgentMode | Autonomy): AgentMode {
  if (mode === 'controlled') return 'ask';
  if (mode === 'authorized') return 'fullAccess';
  return mode;
}

export function isAgentMode(value: unknown): value is AgentMode | Autonomy {
  return typeof value === 'string' && ([...AGENT_MODES, ...LEGACY_AGENT_MODES] as readonly string[]).includes(value);
}

/**
 * 动作的风险等级（封闭枚举，§3.12）：
 * - `read`：查询；
 * - `edit`：对文件与视频的可逆修改；
 * - `command`：运行命令与其他一般动作（取消任务、经已授权的 Provider 生成）；
 * - `high`：写项目目录之外、删除视频或项目、不可逆的覆盖、需要新授权的数据外发或付费调用。
 */
export const RISK_LEVELS = ['read', 'edit', 'command', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** 查表的结果：自动执行、生成待处理的审批，或直接拒绝（`plan` 下的写操作）。 */
export type ApprovalVerdict = 'allow' | 'ask' | 'deny';

/**
 * 决策表（§3.12）。`read` 在任何模式下都自动。
 *
 * | 模式 | edit | command | high |
 * | --- | --- | --- | --- |
 * | plan | 拒绝 | 询问 | 拒绝 |
 * | ask | 询问 | 询问 | 询问 |
 * | autoAcceptEdits | 自动 | 询问 | 询问 |
 * | auto | 自动 | 自动 | 询问 |
 * | fullAccess | 自动 | 自动 | 自动 |
 *
 * `plan` 下的 `command` 只出自 Driver：它在只读沙箱里运行命令前来问，照旧交给用户；BaoCut 的写工具在 `plan` 下直接拒绝。
 */
export function decideApproval(mode: AgentMode, risk: RiskLevel): ApprovalVerdict {
  if (risk === 'read') return 'allow';
  switch (mode) {
    case 'plan':
      return risk === 'command' ? 'ask' : 'deny';
    case 'ask':
      return 'ask';
    case 'autoAcceptEdits':
      return risk === 'edit' ? 'allow' : 'ask';
    case 'auto':
      return risk === 'high' ? 'ask' : 'allow';
    case 'fullAccess':
      return 'allow';
  }
}

/**
 * 对外服务的等级用同一张表（§4.8）：`ask` 与访问模式 `ask` 相同，逐次确认；`auto` 直接执行（与 `fullAccess` 相同，
 * 数据外发另由 Provider 的启用把关）；`read` 只有查询，写工具不在目录里，这里再拒绝一次。
 */
export function decideServiceApproval(level: ServiceLevel, risk: RiskLevel): ApprovalVerdict {
  if (risk === 'read') return 'allow';
  if (level === 'read') return 'deny';
  return level === 'auto' ? 'allow' : 'ask';
}

/** 审批的主体：会话（智能体）或对外服务的客户端。 */
export type ApprovalSubject =
  | { kind: 'conversation'; conversationId: Id; conversationTitle: string; projectId: Id | null; taskId: Id }
  | { kind: 'service'; serviceId: ServiceId; clientId: string; clientName: string };

/**
 * 要确认的动作。`kind`：BaoCut 工具调用、Driver 报上来的命令或文件修改；`name` 是工具名（命令与文件修改为 kind 本身）；
 * `targets` 是目标（视频、文件或命令），`summary` 是给人看的一句参数摘要。
 */
export interface ApprovalAction {
  kind: 'tool' | 'command' | 'file-change';
  name: string;
  targets: string[];
  summary: string;
}

/** 依据：会话当时的模式，或服务当时的等级。 */
export type ApprovalBasis = { kind: 'mode'; mode: AgentMode } | { kind: 'service'; level: ServiceLevel };

/** 一条待处理的审批（统一列表，`tasks` 主题与 `approvals.list`）。会话审批没有时限，`expiresAt` 为 null。 */
export interface PendingApproval {
  approvalId: Id;
  subject: ApprovalSubject;
  action: ApprovalAction;
  risk: RiskLevel;
  basis: ApprovalBasis;
  createdAt: string;
  expiresAt: string | null;
  /**
   * 这次动作要外发、还没有授权覆盖的数据（架构设计 §12.5）。有它时允许可以带上 `grant`（`approvals.respond`）：
   * 只这一次，或同时发放持续授权。一个任务需要的几项授权合并在同一条审批里。
   */
  grants?: GrantRequestItem[];
}

/** 审批的结局：允许、拒绝、超时（只有服务审批）或取消（停止、打断、断开）。 */
export type ApprovalOutcome = 'allowed' | 'denied' | 'timeout' | 'cancelled';

/** 统一入口 `approvals.respond` 的决定。 */
export type PendingApprovalDecision = 'allow' | 'deny';
