import type { ProviderKind, RiskLevel } from '@baocut/protocol';
import type { OutboundPlan } from '../grants/grant-service.ts';

/**
 * 数据外发的授权与模型工具的风险等级（架构设计 §3.12、§12.5）：风险取决于数据交给谁、有没有授权覆盖这次外发。
 * 判断本身在 `GrantService.plan`（按数据种类、接收方、范围、用途与预算匹配授权）；这里只把结果换成风险等级。
 */

export interface OutboundGrant {
  /** 解析不到时为 null（没有默认值、不认识的 Provider）：提交时会被拒绝。 */
  kind: ProviderKind | null;
  /** 用户启用了它（本机模型与已配对的节点总是）。没有启用的提交时会被拒绝，数据不会离开这台机器。 */
  enabled: boolean;
  /** 不离开这台机器，或已有授权覆盖这次外发。 */
  granted: boolean;
}

/** `GrantService.plan` 的结果换成授权状态：`none` 是本机、节点，或没有启用、解析不到的 Provider。 */
export function outboundGrantOf(plan: OutboundPlan): OutboundGrant {
  switch (plan.status) {
    case 'none': {
      const ownDevice = plan.kind === 'local' || plan.kind === 'node';
      return { kind: plan.kind, enabled: ownDevice, granted: ownDevice };
    }
    case 'covered':
      return { kind: plan.kind, enabled: true, granted: true };
    case 'approval':
      return { kind: plan.kind, enabled: true, granted: false };
  }
}

/**
 * 模型工具的风险等级（§3.12）：本机模型是 `edit`（结果是候选素材或产物，不改时间线，可以删掉）；交给已配对的节点、
 * 或有授权覆盖的外发是 `command`；没有授权覆盖的外发是 `high`（审批里带上要授权的数据）。解析不到 Provider、
 * Provider 没有启用时按 `command`：提交时会被拒绝（带补救），数据不会外发，不必为它升级审批。
 */
export function modelCallRisk(grant: OutboundGrant): RiskLevel {
  if (grant.kind === null || !grant.enabled) return 'command';
  if (grant.kind === 'local') return 'edit';
  return grant.granted ? 'command' : 'high';
}
