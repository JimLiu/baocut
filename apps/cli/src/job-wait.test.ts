import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ProgressReporter } from './catalog/progress.ts';
import { CliError } from './envelope.ts';
import { isFinished, waitForJob, watchJobs } from './job-wait.ts';
import { FakeClient, jobRecord } from './testing/fake-client.ts';

const progress = () => new ProgressReporter('jsonl', new PassThrough());
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('waitForJob（Agent 面设计 §5.4）', () => {
  it('终态与 packages/jobs 的 isTerminal 相同：needs-reconciliation 算；Worker 重试的中断不算', () => {
    for (const state of ['completed', 'failed', 'cancelled', 'needs-reconciliation'] as const) {
      expect(isFinished(jobRecord({ jobId: 'j', state })), state).toBe(true);
    }
    expect(isFinished(jobRecord({ jobId: 'j', state: 'running' }))).toBe(false);
    expect(isFinished(jobRecord({ jobId: 'j', state: 'interrupted', error: { code: 'WORKER_CRASHED', message: 'x' } as never }))).toBe(
      false,
    );
    expect(isFinished(jobRecord({ jobId: 'j', state: 'interrupted', error: { code: 'JOB_INTERRUPTED', message: 'x' } as never }))).toBe(
      true,
    );
  });

  it('订阅的事件到终态就结束；needs-reconciliation 也结束', async () => {
    const fake = new FakeClient();
    const watcher = watchJobs(fake.client);
    const waiting = waitForJob(fake.client, 'job_1', watcher, { progress: progress() });
    fake.snapshot([jobRecord({ jobId: 'job_1', state: 'running' })]);
    await tick();
    fake.emit(jobRecord({ jobId: 'job_other', state: 'failed' }));
    fake.emit(jobRecord({ jobId: 'job_1', state: 'needs-reconciliation' }));
    await expect(waiting).resolves.toMatchObject({ kind: 'finished', job: { state: 'needs-reconciliation' } });
    expect(fake.subscribed).toBe(false);
  });

  it('minAttempt：之前那次尝试的终态不算（jobs retry 沿用同一个 jobId）', async () => {
    const fake = new FakeClient();
    const watcher = watchJobs(fake.client);
    fake.snapshot([jobRecord({ jobId: 'job_1', state: 'failed', attempt: 1 })]);
    const waiting = waitForJob(fake.client, 'job_1', watcher, { progress: progress(), minAttempt: 2 });
    let settled = false;
    void waiting.then(() => (settled = true));
    await tick();
    expect(settled).toBe(false);
    fake.emit(jobRecord({ jobId: 'job_1', state: 'running', attempt: 2 }));
    fake.emit(jobRecord({ jobId: 'job_1', state: 'completed', attempt: 2 }));
    await expect(waiting).resolves.toMatchObject({ kind: 'finished', job: { state: 'completed', attempt: 2 } });
  });

  it('initial：快照还没到时先用查过的记录，已经结束的不必等', async () => {
    const fake = new FakeClient();
    const watcher = watchJobs(fake.client);
    const initial = jobRecord({ jobId: 'job_1', state: 'failed', error: { code: 'GRANT_REQUIRED', message: '要授权' } as never });
    await expect(waitForJob(fake.client, 'job_1', watcher, { progress: progress(), initial })).resolves.toMatchObject({
      kind: 'finished',
      job: { state: 'failed' },
    });
  });

  it('超时：结果是 timeout 与最近的记录，任务不取消', async () => {
    const fake = new FakeClient();
    const watcher = watchJobs(fake.client);
    fake.snapshot([jobRecord({ jobId: 'job_1', state: 'running' })]);
    const outcome = await waitForJob(fake.client, 'job_1', watcher, { progress: progress(), timeoutSec: 0.05 });
    expect(outcome).toMatchObject({ kind: 'timeout', job: { state: 'running' } });
    expect(fake.calls.map((call) => call.method)).not.toContain('jobs.cancel');
  });

  it('连接断了：RUNTIME_UNAVAILABLE（退出码 3），带 jobId', async () => {
    const fake = new FakeClient();
    const watcher = watchJobs(fake.client);
    const waiting = waitForJob(fake.client, 'job_1', watcher, { progress: progress() });
    fake.disconnect('Runtime 退出了');
    const error = await waiting.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({ code: 'RUNTIME_UNAVAILABLE', extra: { jobId: 'job_1' } });
  });
});
