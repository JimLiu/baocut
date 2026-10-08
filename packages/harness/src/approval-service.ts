import {
  RpcError,
  decideApproval,
  decideServiceApproval,
  newId,
  type ApprovalAction,
  type ApprovalGrantChoice,
  type ApprovalBasis,
  type ApprovalOutcome,
  type ApprovalSubject,
  type ApprovalVerdict,
  type GrantRequestItem,
  type Id,
  type PendingApproval,
  type PendingApprovalDecision,
  type RiskLevel,
} from '@baocut/protocol';
import { HarnessAgents as HA } from '@baocut/protocol/messages/harness';

/**
 * 一条审批的结局。`forSession`：用户选了「这个任务里不再问同一种动作」（只有会话审批用到）。
 * `grant`：带外发授权的审批允许时用户的选择（只这一次，或同时发放持续授权，§12.5）；没有选择时按只这一次。
 */
export interface ApprovalResolution {
  outcome: ApprovalOutcome;
  forSession: boolean;
  grant?: ApprovalGrantChoice;
}

export interface ApprovalRequestInput {
  subject: ApprovalSubject;
  action: ApprovalAction;
  risk: RiskLevel;
  basis: ApprovalBasis;
  /** 时限（毫秒），到时按 `timeout` 结束（调用方按拒绝处理）；null 不超时（会话审批）。 */
  timeoutMs: number | null;
  /** 中止（外部请求断开）时按取消处理。 */
  signal?: AbortSignal;
  /** 沿用调用方的审批号（Driver 的、服务审批的）；已被占用或没给时另起一个。 */
  approvalId?: Id;
  /** 结束时同步调用，先于 `respond` 返回：调用方在这里更新会话条目、回答 Driver。 */
  onSettled?: (resolution: ApprovalResolution) => void;
  /** 这次动作要外发、还没有授权覆盖的数据（§12.5）：允许时可以带上授权的选择。 */
  grants?: GrantRequestItem[];
}

export type ApprovalServiceEvent =
  { type: 'requested'; approval: PendingApproval } | { type: 'resolved'; approval: PendingApproval; outcome: ApprovalOutcome };

interface Entry {
  approval: PendingApproval;
  settle: (resolution: ApprovalResolution) => void;
}

/**
 * ApprovalService（架构设计 §3.12、§4.8）：会话里的动作与对外服务的请求共用的审批。
 *
 * - `decide`：访问模式（或服务等级）× 风险等级查表，得到自动、询问或拒绝；
 * - `request`：生成一条待处理的审批并等待：用户允许或拒绝、超时（只有服务审批有时限）、取消（停止、打断、断开）；
 * - 待处理的审批在一处列出（`pending`），出现与结束经 `subscribe` 通知（Harness 送到 `tasks` 主题）。
 *
 * 这里只管待处理的审批与结局；会话条目、Driver 的回答与服务主题由各自的调用方在 `onSettled` 与通知里处理。
 */
export class ApprovalService {
  readonly #pending = new Map<Id, Entry>();
  readonly #listeners = new Set<(event: ApprovalServiceEvent) => void>();

  /** 查表：会话按模式，对外服务按等级。 */
  decide(basis: ApprovalBasis, risk: RiskLevel): ApprovalVerdict {
    return basis.kind === 'mode' ? decideApproval(basis.mode, risk) : decideServiceApproval(basis.level, risk);
  }

  /** 生成一条待处理的审批。`resolution` 在用户处理、超时或取消时兑现，从不拒绝。 */
  request(input: ApprovalRequestInput): { approvalId: Id; resolution: Promise<ApprovalResolution> } {
    const approvalId = input.approvalId && !this.#pending.has(input.approvalId) ? input.approvalId : newId('apv');
    const now = Date.now();
    const approval: PendingApproval = {
      approvalId,
      subject: structuredClone(input.subject),
      action: structuredClone(input.action),
      risk: input.risk,
      basis: structuredClone(input.basis),
      createdAt: new Date(now).toISOString(),
      expiresAt: input.timeoutMs === null ? null : new Date(now + input.timeoutMs).toISOString(),
      ...(input.grants?.length ? { grants: structuredClone(input.grants) } : {}),
    };
    if (input.signal?.aborted) {
      const resolution: ApprovalResolution = { outcome: 'cancelled', forSession: false };
      input.onSettled?.(resolution);
      return { approvalId, resolution: Promise.resolve(resolution) };
    }
    const resolution = new Promise<ApprovalResolution>((resolve) => {
      const timer = input.timeoutMs === null ? null : setTimeout(() => settle({ outcome: 'timeout', forSession: false }), input.timeoutMs);
      timer?.unref?.();
      const onAbort = () => settle({ outcome: 'cancelled', forSession: false });
      const settle = (result: ApprovalResolution) => {
        if (this.#pending.get(approvalId)?.approval !== approval) return;
        this.#pending.delete(approvalId);
        if (timer) clearTimeout(timer);
        input.signal?.removeEventListener('abort', onAbort);
        try {
          input.onSettled?.(result);
        } finally {
          this.#emit({ type: 'resolved', approval: structuredClone(approval), outcome: result.outcome });
          resolve(result);
        }
      };
      this.#pending.set(approvalId, { approval, settle });
      input.signal?.addEventListener('abort', onAbort, { once: true });
    });
    this.#emit({ type: 'requested', approval: structuredClone(approval) });
    return { approvalId, resolution };
  }

  /**
   * 用户的决定。已经处理过、超时、取消的与不存在的都返回 `already-resolved`。
   * `grant` 只用于带外发授权的审批（不带的给了是 `invalid-request`）；带外发授权的审批不能「这个任务里不再问」：
   * 每一次外发都要有授权覆盖（§12.5）。
   */
  respond(
    approvalId: Id,
    decision: PendingApprovalDecision,
    options: { forSession?: boolean; grant?: ApprovalGrantChoice } = {},
  ): { status: 'allowed' | 'denied' | 'already-resolved' } {
    const entry = this.#pending.get(approvalId);
    if (!entry) return { status: 'already-resolved' };
    const outbound = (entry.approval.grants?.length ?? 0) > 0;
    if (options.grant && !outbound) throw new RpcError('invalid-request', HA.approvalNoGrant());
    const outcome = decision === 'allow' ? 'allowed' : 'denied';
    entry.settle({
      outcome,
      forSession: outcome === 'allowed' && options.forSession === true && !outbound,
      ...(outcome === 'allowed' && outbound ? { grant: options.grant ?? { persist: false } } : {}),
    });
    return { status: outcome };
  }

  /** 取消一条（停止、打断、Driver 自己撤回）。不在待处理里时为 false。 */
  cancel(approvalId: Id): boolean {
    const entry = this.#pending.get(approvalId);
    if (!entry) return false;
    entry.settle({ outcome: 'cancelled', forSession: false });
    return true;
  }

  /** 取消符合条件的全部（会话的任务结束、服务停止），返回取消的条数。 */
  cancelWhere(predicate: (approval: PendingApproval) => boolean): number {
    let count = 0;
    for (const entry of [...this.#pending.values()]) {
      if (!predicate(entry.approval)) continue;
      entry.settle({ outcome: 'cancelled', forSession: false });
      count++;
    }
    return count;
  }

  /** 待处理的审批，旧的在前。 */
  pending(): PendingApproval[] {
    return [...this.#pending.values()].map((entry) => structuredClone(entry.approval));
  }

  get(approvalId: Id): PendingApproval | null {
    const entry = this.#pending.get(approvalId);
    return entry ? structuredClone(entry.approval) : null;
  }

  subscribe(listener: (event: ApprovalServiceEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: ApprovalServiceEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // 订阅方的错误不影响审批本身。
      }
    }
  }
}
