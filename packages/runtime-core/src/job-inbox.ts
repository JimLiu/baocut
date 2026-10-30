import type { Harness, Logger } from '@baocut/harness';
import type { JobManager } from '@baocut/jobs';
import type { JobRecord } from '@baocut/protocol';

/** 结束后等多久再交给 Harness（毫秒）：智能体正在 `jobs_wait` 等它时，给等待返回、记为看过留出时间。 */
export const JOB_INBOX_DELAY_MS = 1500;

type Finished = Pick<JobRecord, 'jobId' | 'attempt'>;

/**
 * 完成收件箱（架构设计 §7.2）：会话里的智能体提交的 Job 结束了、它在回合里没看结果时，交给 Harness 告诉它（`Harness.jobFinished`
 * 决定插话、唤醒还是不告诉）。
 *
 * - 只看智能体提交的顶层 Job（不是固定流程里的一步）的 `completed` 与 `failed`；取消、中断、待核对的不交；
 * - 智能体用 `jobs_inspect` / `jobs_wait` 看到了这次结束（`markSeen`）就不交；结束后先等 `delayMs`，给正在等它的 `jobs_wait` 返回；
 * - 每次结束（Job 与第几次尝试）只交一次；`jobs_retry` 之后是新的一次。只在内存里，Runtime 重启前结束的不补交。
 */
export class JobInbox {
  readonly #harness: Pick<Harness, 'jobFinished'>;
  readonly #log: Logger;
  readonly #delayMs: number;
  /** 智能体看到过的结束。交过之后不再需要，删掉。 */
  readonly #seen = new Set<string>();
  /** 已经排上（等着交或交过）的结束。 */
  readonly #handled = new Set<string>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #unsubscribe: () => void;
  #closed = false;

  constructor(options: { jobs: Pick<JobManager, 'onChange'>; harness: Pick<Harness, 'jobFinished'>; log: Logger; delayMs?: number }) {
    this.#harness = options.harness;
    this.#log = options.log;
    this.#delayMs = options.delayMs ?? JOB_INBOX_DELAY_MS;
    this.#unsubscribe = options.jobs.onChange((job) => this.#onChange(job));
  }

  /** 智能体看到了一个 Job 的记录（`jobs_inspect`，`jobs_wait` 也经它）：是终态时，这次结束不用再交。 */
  markSeen(job: Pick<JobRecord, 'jobId' | 'attempt' | 'state'>): void {
    if (job.state === 'completed' || job.state === 'failed') this.#seen.add(keyOf(job));
  }

  close(): void {
    this.#closed = true;
    this.#unsubscribe();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  #onChange(job: JobRecord): void {
    if (this.#closed || job.parentJobId || job.submitter.kind !== 'agent') return;
    if (job.state !== 'completed' && job.state !== 'failed') return;
    const key = keyOf(job);
    if (this.#handled.has(key)) return;
    this.#handled.add(key);
    const { id: conversationId, taskId } = job.submitter;
    const finished = { conversationId, taskId, jobId: job.jobId, kind: job.kind, attempt: job.attempt, state: job.state };
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      if (this.#seen.delete(key)) return;
      this.#harness
        .jobFinished(finished)
        .catch((error: unknown) =>
          this.#log.warn('Failed to tell the agent a job finished', { conversationId, jobId: job.jobId, error: String(error) }),
        );
    }, this.#delayMs);
    timer.unref?.();
    this.#timers.add(timer);
  }
}

function keyOf(job: Finished): string {
  return `${job.jobId}#${job.attempt}`;
}
