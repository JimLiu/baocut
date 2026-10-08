import type { BaoCutClient } from '@baocut/client';
import type { JobRecord } from '@baocut/protocol';
import { M } from './cli-copy.ts';
import { CliError } from './envelope.ts';
import type { ProgressReporter } from './catalog/progress.ts';

/**
 * 等一个任务到终态（Agent 面设计 §5.4）：派生命令的 `--wait` 与管理桶里要跟进度的命令共用。
 *
 * - 订阅 `jobs` 主题，不轮询；提交之前先订阅（`watchJobs`），提交之后的每次变化都不会漏掉。
 * - Ctrl-C 请 Runtime 取消任务、照旧等到终态（`cancelled`）；再按一次直接退出（130），任务照旧在 Runtime 里。
 * - 连接断开：`RUNTIME_UNAVAILABLE`（退出码 3）。
 */

/** `jobs` 主题的镜像：任务 id → 最新记录；`listen` 之后的每次变化交给监听者。 */
export interface JobWatcher {
  records: ReadonlyMap<string, JobRecord>;
  listen(listener: (job: JobRecord) => void): void;
  close(): void;
}

export function watchJobs(client: BaoCutClient): JobWatcher {
  const records = new Map<string, JobRecord>();
  let listener: ((job: JobRecord) => void) | null = null;
  const close = client.subscribeJobs({
    snapshot: (snapshot) => {
      records.clear();
      for (const job of snapshot.jobs) records.set(job.jobId, job);
      if (listener) for (const job of snapshot.jobs) listener(job);
    },
    event: (event) => {
      // 实时段落（`job.segments`）与等任务无关。
      if (event.type !== 'job.updated') return;
      records.set(event.job.jobId, event.job);
      listener?.(event.job);
    },
  });
  return {
    records,
    listen: (next) => (listener = next),
    close: () => void close(),
  };
}

/**
 * 终态：`completed`、`failed`、`cancelled`、`needs-reconciliation`（与 `packages/jobs` 的 `isTerminal` 相同；要用户对账，退出码按
 * 失败算）。Worker 崩溃后的自动重试（`interrupted` → `running`）不算终结；Runtime 停止造成的中断（`JOB_INTERRUPTED`）算。
 */
export function isFinished(job: JobRecord): boolean {
  return (
    job.state === 'completed' ||
    job.state === 'failed' ||
    job.state === 'cancelled' ||
    job.state === 'needs-reconciliation' ||
    (job.state === 'interrupted' && job.error?.code === 'JOB_INTERRUPTED')
  );
}

export interface WaitOptions {
  progress: ProgressReporter;
  /** 秒；到时不取消任务，结果是 `timeout`。 */
  timeoutSec?: number | undefined;
  /** 只认第几次尝试之后的记录（重试时，之前的终态不算）。 */
  minAttempt?: number;
  /** 订阅的快照还没到时先用的记录（`jobs wait` 先查过一次）：已经结束的任务不必等快照。 */
  initial?: JobRecord;
  /** 每次记录变化（进度之外还要做的事，例如逐行打出命令的输出）。 */
  onUpdate?: (job: JobRecord) => void;
}

export type WaitOutcome = { kind: 'finished'; job: JobRecord } | { kind: 'timeout'; job: JobRecord | null };

/** 等 `jobId` 到终态或超时；结束时关掉 `watcher`。 */
export function waitForJob(client: BaoCutClient, jobId: string, watcher: JobWatcher, options: WaitOptions): Promise<WaitOutcome> {
  const { progress } = options;
  let latest: JobRecord | null = null;
  let settled = false;
  let cancelRequested = false;

  return new Promise<WaitOutcome>((resolve, reject) => {
    const cleanups: (() => void)[] = [() => watcher.close()];
    const settle = (outcome: WaitOutcome | Error) => {
      if (settled) return;
      settled = true;
      for (const cleanup of cleanups) cleanup();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };

    const onJob = (job: JobRecord) => {
      if (job.jobId !== jobId || settled || job.attempt < (options.minAttempt ?? 1)) return;
      latest = job;
      progress.update(job);
      options.onUpdate?.(job);
      if (!isFinished(job)) return;
      progress.done(job);
      settle({ kind: 'finished', job });
    };

    watcher.listen(onJob);
    cleanups.push(
      client.onState((state) => {
        if (state.status === 'disconnected' || state.status === 'incompatible') {
          settle(new CliError('RUNTIME_UNAVAILABLE', M.runtimeLost(state.reason), { jobId }));
        }
      }),
    );

    if (options.timeoutSec !== undefined) {
      const seconds = options.timeoutSec;
      const timer = setTimeout(() => {
        progress.note(M.waitTimeout(seconds, jobId));
        settle({ kind: 'timeout', job: latest });
      }, seconds * 1000);
      cleanups.push(() => clearTimeout(timer));
    }

    const onSigint = () => {
      if (cancelRequested) process.exit(130);
      cancelRequested = true;
      progress.cancelling(jobId);
      client.request('jobs.cancel', { jobId }).catch((error: unknown) => progress.note(M.jobCancelFailed(String(error))));
    };
    process.on('SIGINT', onSigint);
    cleanups.push(() => process.off('SIGINT', onSigint));

    const current = watcher.records.get(jobId) ?? options.initial;
    if (current) onJob(current);
  });
}
