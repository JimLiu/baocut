import {
  AGENT_MODE_LABELS,
  live,
  type AgentMode,
  type ApprovalRequest,
  type PendingApproval,
  type PendingApprovalDecision,
  type RiskLevel,
} from '@baocut/protocol';
import { M } from './approvals-copy.ts';

/**
 * 访问模式的命令行写法与 `baocut approvals` 的参数与输出（架构设计 §3.12）。从 main.ts 分出来，单独可测。
 */

/** `--mode` 的写法（连字符小写）→ 协议里的值。 */
const MODE_FLAGS: Readonly<Record<string, AgentMode>> = {
  ask: 'ask',
  'auto-accept-edits': 'autoAcceptEdits',
  auto: 'auto',
  'full-access': 'fullAccess',
  plan: 'plan',
};

/** `--mode` → 发送用的访问模式；不给时为 undefined（用会话的模式）。 */
export function parseModeOption(mode: string | undefined): AgentMode | undefined {
  if (mode === undefined) return undefined;
  const flag = MODE_FLAGS[mode];
  if (!flag) throw new Error(M.unknownMode(mode, Object.keys(MODE_FLAGS)));
  return flag;
}

/** 访问模式给人看的写法：名字与命令行写法。 */
export function formatMode(mode: AgentMode): string {
  const flag = Object.keys(MODE_FLAGS).find((key) => MODE_FLAGS[key] === mode) ?? mode;
  return M.mode(AGENT_MODE_LABELS[mode], flag);
}

export type ApprovalsCommand = { kind: 'list' } | { kind: 'respond'; approvalId: string; decision: PendingApprovalDecision };

export function parseApprovalsArgs(args: string[]): ApprovalsCommand {
  const [action, approvalId, ...extra] = args;
  if (action === undefined || action === 'list') {
    if (approvalId !== undefined) throw new Error(M.usage);
    return { kind: 'list' };
  }
  if ((action === 'allow' || action === 'deny') && approvalId && extra.length === 0) {
    return { kind: 'respond', approvalId, decision: action };
  }
  throw new Error(M.usage);
}

const RISK_LABELS: Readonly<Record<RiskLevel, string>> = live(() => M.riskLabels);

/** 待处理的审批，一条一行：审批号、来自谁、动作与风险、依据，以及服务审批的时限。 */
export function formatApprovals(approvals: PendingApproval[], now: number = Date.now()): string[] {
  if (approvals.length === 0) return [M.none];
  return approvals.map((a) => {
    const who =
      a.subject.kind === 'conversation'
        ? M.fromSession(a.subject.conversationTitle || a.subject.conversationId)
        : M.fromService(a.subject.serviceId, a.subject.clientName);
    const basis = a.basis.kind === 'mode' ? M.basisMode(formatMode(a.basis.mode)) : M.basisLevel(String(a.basis.level));
    return M.approvalLine({
      id: a.approvalId,
      who,
      action: a.action.name,
      targets: a.action.targets,
      risk: RISK_LABELS[a.risk],
      summary: a.action.summary,
      basis,
      secondsLeft: a.expiresAt === null ? null : Math.max(0, Math.ceil((Date.parse(a.expiresAt) - now) / 1000)),
    });
  });
}

/** 会话里的一条审批要做什么（`baocut chat` 的提示）。 */
export function describeApprovalRequest(request: ApprovalRequest): string {
  switch (request.kind) {
    case 'command':
      return M.runCommand(request.command);
    case 'file-change':
      return M.changeFiles(request.files);
    case 'tool':
      return M.callTool(request.tool, request.files);
  }
}
