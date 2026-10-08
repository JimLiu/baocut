import type { ApplicationRecord, Id, JobCancellation, JobRecord } from '@baocut/protocol';
import { applicationOpen } from './job-application.ts';
import { isTerminal, type StoredJob } from './job-ledger.ts';

/**
 * 重启时的恢复矩阵（架构设计 §7.5）：读账本时按每个任务停在哪里决定怎么处理。这里只做判断，执行在 JobManager。
 *
 * | 停在哪里 | 处理 |
 * | --- | --- |
 * | 排队，还没有被领取（连接、Runtime 或对外服务提交的转写与生成） | 旧的预留释放；重新排队之前重新校验（视频与素材、Provider、授权与预算） |
 * | 排队，智能体提交 | `interrupted`：它的 Run 已经随重启结束，不执行已停止的旧 Run |
 * | 本机或节点在跑，没有恢复能力 | `interrupted`，允许新的尝试（`jobs.reconcile retry` 或重新提交） |
 * | 在线或智能体 Provider 在跑，有可查询的远端任务 ID | 查询远端（`RemoteTaskQuery`）；目前没有 Provider 支持 |
 * | 在线或智能体 Provider 在跑，结果未知、不可查询 | `needs-reconciliation`，预算按保守规则扣，从不自动重发 |
 * | 产物已经发布，应用没有结束 | 复用产物：先按记下的 `commandId` 查回执，没有提交过才重新校验并应用 |
 * | 固定流程的父任务与步骤 | `interrupted`，由 PipelineRunner 自己对账 |
 * | 不经模型的任务（导出、模型安装）、远端节点代执行的、没有视频的转写 | `interrupted`（执行函数或输入文件只在内存里） |
 */

export type RecoveryAction =
  /** 已经终结，不动。 */
  | { kind: 'keep' }
  /** 标为 `interrupted`。 */
  | { kind: 'interrupt' }
  /** 释放旧的预留，校验后重新排队。 */
  | { kind: 'requeue' }
  /** 标为 `needs-reconciliation`。 */
  | { kind: 'reconcile' }
  /** 查询远端任务。 */
  | { kind: 'query-remote'; remoteTaskId: string }
  /** 复用已经发布的产物，补做应用。 */
  | { kind: 'resume-application' };

/**
 * 可查询的远端任务（§7.5「云端已提交，有任务 ID」）：Provider 提交之后给出远端任务 ID、记进账本，重启后按它查询。
 * 现有的在线适配器都是一次同步的 HTTP 请求，没有远端任务 ID，也没有实现这个接口；查到 `pending`、`running` 或
 * `succeeded` 时怎样取回结果（续跑）没有定义，这些情况一律转为 `needs-reconciliation`（架构设计 §14）。
 */
export interface RemoteTaskQuery {
  supports(providerId: string): boolean;
  query(task: { jobId: Id; providerId: string; modelId: string; remoteTaskId: string }): Promise<RemoteTaskStatus>;
}

export type RemoteTaskStatus =
  /** 远端没有这个任务：请求没有到达。 */
  { status: 'not-found' } | { status: 'failed'; message: string } | { status: 'pending' | 'running' | 'succeeded' };

/** 在线或智能体 Provider（数据外发、可能计费）；本机与节点不是。 */
export function isExternalProvider(providerId: string): boolean {
  return providerId !== 'local' && !providerId.startsWith('node:');
}

/** 能不能由 Runtime 重新排队（重启时）或由用户重试（`jobs.reconcile retry`）：有视频的转写与生成任务。 */
export function retryable(job: StoredJob): boolean {
  const { record, spec } = job;
  if (record.parentJobId != null) return false;
  if (record.submitter.kind === 'node' || record.submitter.kind === 'pipeline') return false;
  if ('hosted' in spec || 'task' in spec) return false;
  if ('capability' in spec) return true;
  return record.kind === 'transcribe' && record.videoId !== null;
}

export function recoveryAction(job: StoredJob, latest: ApplicationRecord | undefined, remote: RemoteTaskQuery | undefined): RecoveryAction {
  const { record, spec } = job;
  if (latest && applicationOpen(latest.state)) return { kind: 'resume-application' };
  if (isTerminal(record.state)) return { kind: 'keep' };
  if ('hosted' in spec) return { kind: 'interrupt' };
  if (record.state === 'queued') {
    const agent = record.submitter.kind === 'agent';
    return retryable(job) && !agent ? { kind: 'requeue' } : { kind: 'interrupt' };
  }
  // 本机与节点的计算没有恢复能力；不能由用户重试的（固定流程的步骤、没有视频的转写、不经模型的任务）也只是中断：
  // 预算照样按开始与否结算，标成 `needs-reconciliation` 只会留下一条只能放弃的记录。
  if (!isExternalProvider(record.providerId) || !retryable(job)) return { kind: 'interrupt' };
  if (job.remoteTaskId && remote?.supports(record.providerId)) return { kind: 'query-remote', remoteTaskId: job.remoteTaskId };
  return { kind: 'reconcile' };
}

/**
 * 取消或放弃时的三件事实（§7.4）。`stage`：
 * - `queued`：还没有开始，什么都没有发出；
 * - `running`：正在执行时被停下（`confirmed`：执行者确认停下了，节点会这样回复）；
 * - `after-result`：结果已经拿到、只是没有应用（停止屏障拦下了自动应用）；
 * - `unknown`：放弃一个结果不明的外发调用（`jobs.reconcile discard`）。
 */
export function cancellationFacts(
  record: Pick<JobRecord, 'providerId'>,
  stage: 'queued' | 'running' | 'after-result' | 'unknown',
  requestedAt: string,
  options: { confirmed?: boolean; now?: string } = {},
): JobCancellation {
  const localStoppedAt = options.now ?? new Date().toISOString();
  const external = isExternalProvider(record.providerId);
  const node = record.providerId.startsWith('node:');
  let remote: JobCancellation['remote'];
  let cost: JobCancellation['cost'] = 'none';
  switch (stage) {
    case 'queued':
      remote = external || node ? 'not-submitted' : 'not-applicable';
      break;
    case 'running':
      if (external) {
        // 断开 HTTP 请求不等于供应商停下：请求可能仍在远端完成并计费。
        remote = 'cancel-unsupported';
        cost = 'possible';
      } else remote = node ? (options.confirmed ? 'cancelled' : 'unknown') : 'not-applicable';
      break;
    case 'after-result':
      remote = 'not-applicable';
      cost = external ? 'charged' : 'none';
      break;
    case 'unknown':
      remote = 'unknown';
      cost = external ? 'possible' : 'none';
      break;
  }
  return { requestedAt, localStoppedAt, remote, cost };
}
