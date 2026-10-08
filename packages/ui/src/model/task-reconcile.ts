import type { JobReconcileDecision, JobRecord } from '@baocut/protocol';
import { jobRetrying } from './task-list.ts';

/**
 * 任务详情里给用户的对账决定（架构设计 §7.5，`jobs.reconcile`）。照 Runtime 的 `reconcileChoices`（packages/jobs 的
 * job-reconcile.ts）从记录上能看到的事实推算；Runtime 才是准的：看不到的条件（例如托管的执行方式）由它以
 * `RECONCILE_NOT_ALLOWED` 拒绝，界面如实提示。
 *
 * - `retry`：`needs-reconciliation` 或 `interrupted` 的生成任务与有视频的转写，不是固定流程的一步、不是远端节点提交的；
 * - `discard`：`needs-reconciliation`；
 * - `apply`：`failed` 或 `cancelled`，产物在、有视频，最近一次应用是 `stale-input`、`rejected` 或 `cancelled`。
 */
export function reconcileOptions(job: JobRecord): JobReconcileDecision[] {
  const options: JobReconcileDecision[] = [];
  // 崩溃后正在自动重跑的（`interrupted`、没有 `endedAt`）还没结束，不给决定。
  if (jobRetrying(job)) return options;
  if ((job.state === 'needs-reconciliation' || job.state === 'interrupted') && retryable(job)) options.push('retry');
  if (job.state === 'needs-reconciliation') options.push('discard');
  const latest = job.applications?.at(-1);
  if (
    (job.state === 'failed' || job.state === 'cancelled') &&
    job.videoId !== null &&
    job.result !== null &&
    latest !== undefined &&
    (latest.state === 'stale-input' || latest.state === 'rejected' || latest.state === 'cancelled')
  ) {
    options.push('apply');
  }
  return options;
}

function retryable(job: JobRecord): boolean {
  if (job.parentJobId != null) return false;
  if (job.submitter.kind === 'node' || job.submitter.kind === 'pipeline') return false;
  if (job.generation) return true;
  return job.kind === 'transcribe' && job.videoId !== null;
}

/** 交给在线或智能体 Provider 的调用（数据外发、可能计费）；本机与远端节点不是。 */
export function chargesOnRetry(job: Pick<JobRecord, 'providerId'>): boolean {
  return job.providerId !== 'local' && !job.providerId.startsWith('node:');
}
