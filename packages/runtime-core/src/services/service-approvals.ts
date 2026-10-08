import {
  newId,
  type GrantRequestItem,
  type Id,
  type RiskLevel,
  type ServiceApproval,
  type ServiceApprovalDecision,
  type ServiceApprovalOutcome,
  type ServiceId,
  type ServiceLevel,
} from '@baocut/protocol';
import { ApprovalService, type ApprovalResolution } from '@baocut/harness';

/**
 * 服务审批（架构设计 §4.8）：`ask` 等级下，外部请求的写入、任务与生成在执行之前由用户在 BaoCut 里逐次允许或拒绝。
 * 没有会话可挂：待处理的审批经 `services` 主题送达（`approval.requested` / `approval.resolved`），用 `services.respondToApproval` 处理。
 *
 * - 有时限，到时按拒绝处理（`timeout`）；
 * - 外部请求断开、服务停止时取消（`cancelled`），调用方不会在之后被执行。
 *
 * 审批本身由统一的 ApprovalService（§3.12）产生与结束：同一条也出现在 `tasks` 主题的待处理列表里，
 * 用 `approvals.respond` 处理与用 `services.respondToApproval` 处理是一回事。这里只维护服务主题需要的形状。
 */

export interface ServiceApprovalsOptions {
  timeoutMs: number;
  /** 审批出现与结束：送到 `services` 主题。 */
  onRequested: (approval: ServiceApproval) => void;
  onResolved: (approvalId: Id, outcome: ServiceApprovalOutcome) => void;
  /** 统一的审批（Harness 的那一份）。不给时用自己的一份（测试、单独使用）。 */
  approvals?: ApprovalService;
}

/** 审批的依据：动作的风险与服务此刻的等级。不给时按 `command` 与 `ask`。 */
export interface ServiceApprovalBasis {
  risk?: RiskLevel;
  level?: ServiceLevel;
  /** 这次请求要外发、还没有授权覆盖的数据（§12.5）：审批里列出，允许时带回授权的选择。 */
  grants?: GrantRequestItem[];
}

export class ServiceApprovals {
  readonly #options: ServiceApprovalsOptions;
  readonly #unified: ApprovalService;
  readonly #pending = new Map<Id, ServiceApproval>();

  constructor(options: ServiceApprovalsOptions) {
    this.#options = options;
    this.#unified = options.approvals ?? new ApprovalService();
  }

  /** 待处理的审批，旧的在前。 */
  pending(): ServiceApproval[] {
    return [...this.#pending.values()].map((approval) => structuredClone(approval));
  }

  /** 发起一条审批，等用户处理、超时或取消。`signal` 中止（外部请求断开）时按取消处理。 */
  request(
    input: Omit<ServiceApproval, 'approvalId' | 'createdAt' | 'expiresAt'>,
    signal: AbortSignal | undefined,
    basis: ServiceApprovalBasis = {},
  ): Promise<ServiceApprovalOutcome> {
    return this.resolve(input, signal, basis).then((r) => r.outcome);
  }

  /** 同 `request`，结局里带上用户对外发授权的选择（`grant`）。 */
  resolve(
    input: Omit<ServiceApproval, 'approvalId' | 'createdAt' | 'expiresAt'>,
    signal: AbortSignal | undefined,
    basis: ServiceApprovalBasis = {},
  ): Promise<ApprovalResolution> {
    if (signal?.aborted) return Promise.resolve({ outcome: 'cancelled', forSession: false });
    const { approvalId, resolution } = this.#unified.request({
      approvalId: newId('sap'),
      subject: { kind: 'service', serviceId: input.serviceId, clientId: input.clientId, clientName: input.clientName },
      action: { kind: 'tool', name: input.tool, targets: input.video ? [input.video.name] : [], summary: input.summary },
      risk: basis.risk ?? 'command',
      basis: { kind: 'service', level: basis.level ?? 'ask' },
      timeoutMs: this.#options.timeoutMs,
      ...(signal ? { signal } : {}),
      ...(basis.grants?.length ? { grants: basis.grants } : {}),
      onSettled: ({ outcome }) => {
        if (!this.#pending.delete(approvalId)) return;
        this.#options.onResolved(approvalId, outcome);
      },
    });
    const unified = this.#unified.get(approvalId);
    const now = new Date().toISOString();
    const approval: ServiceApproval = {
      ...input,
      approvalId,
      createdAt: unified?.createdAt ?? now,
      expiresAt: unified?.expiresAt ?? now,
    };
    this.#pending.set(approvalId, approval);
    this.#options.onRequested(structuredClone(approval));
    return resolution;
  }

  /** 用户的决定。已经处理过、超时或取消的（以及不是服务审批的）返回 `already-resolved`。 */
  respond(approvalId: Id, decision: ServiceApprovalDecision): { status: 'allowed' | 'denied' | 'already-resolved' } {
    if (!this.#pending.has(approvalId)) return { status: 'already-resolved' };
    return this.#unified.respond(approvalId, decision);
  }

  /** 服务停止：它待处理的审批全部取消。 */
  cancelService(serviceId: ServiceId): void {
    this.#unified.cancelWhere((a) => a.subject.kind === 'service' && a.subject.serviceId === serviceId && this.#pending.has(a.approvalId));
  }
}
