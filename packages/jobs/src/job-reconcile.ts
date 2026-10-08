import { RpcError, type ApplicationRecord, type JobReconcileDecision } from '@baocut/protocol';
import { JobsReconcile as J } from '@baocut/protocol/messages/jobs/job-reconcile.ts';
import type { StoredJob } from './job-ledger.ts';
import { joinList } from './job-text.ts';
import { retryable } from './job-recovery.ts';

/**
 * `jobs.reconcile` 的决定与它们合法的状态（架构设计 §7.5）。集合封闭，没有别的决定：
 *
 * | 决定 | 合法的状态 | 结果 |
 * | --- | --- | --- |
 * | `retry` | `needs-reconciliation`、`interrupted` 的转写（有视频）与生成任务 | 同一个任务回到 `queued`、`attempt` 加一，重新准入（新的一次调用与预留）；有视频时视频要已经打开 |
 * | `discard` | `needs-reconciliation` | `cancelled`，记下取消的三件事实；按保守规则扣下的预算不退 |
 * | `apply` | `failed`、`cancelled` 且最近一次应用是 `stale-input`、`rejected` 或 `cancelled`，产物在 | 先按旧的 `commandId` 查回执，再新建一次应用、重新校验后提交；视频要已经打开 |
 *
 * 没有「标为已提交 / 未提交」：用户的判断无从核实，不拿它退预算或重放请求。
 */

export const RECONCILE_DECISIONS: readonly JobReconcileDecision[] = ['retry', 'discard', 'apply'];

export function reconcileChoices(job: StoredJob, latest: ApplicationRecord | undefined): JobReconcileDecision[] {
  const { record } = job;
  const choices: JobReconcileDecision[] = [];
  if ((record.state === 'needs-reconciliation' || record.state === 'interrupted') && retryable(job)) choices.push('retry');
  if (record.state === 'needs-reconciliation') choices.push('discard');
  if (
    (record.state === 'failed' || record.state === 'cancelled') &&
    record.videoId !== null &&
    record.result !== null &&
    latest !== undefined &&
    (latest.state === 'stale-input' || latest.state === 'rejected' || latest.state === 'cancelled')
  ) {
    choices.push('apply');
  }
  return choices;
}

export function reconcileNotAllowed(job: StoredJob, decision: JobReconcileDecision, allowed: JobReconcileDecision[]): RpcError {
  const message = allowed.length > 0 ? J.onlyAllowed({ allowed: joinList(allowed) }) : J.noneAllowed();
  return new RpcError('conflict', message, { code: 'RECONCILE_NOT_ALLOWED', state: job.record.state, decision, allowed });
}
