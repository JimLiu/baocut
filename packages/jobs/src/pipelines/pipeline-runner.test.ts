import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcError, type JobRecord } from '@baocut/protocol';
import { JobLedger } from '../job-ledger.ts';
import type { JobManager, JobManagerOptions } from '../job-manager.ts';
import { testJobManager } from '../testing/pipeline-jobs.ts';
import { PipelineStepError, type PipelineDefinition, type StepResult } from './pipeline.ts';
import { PipelineRunner } from './pipeline-runner.ts';

/**
 * 固定流程框架（架构设计 §7.9）：用一个只在测试里的三步假流程检查步骤顺序与进度、子任务的提交者与父任务、
 * 失败停在那一步、重试复用之前的产出、取消的屏障、重启之后的状态。
 */

interface FakeParams {
  value: string;
}

/** 假流程的控制：每一步执行几次、在哪一步失败、在哪一步卡住。 */
class FakeControl {
  runs: string[] = [];
  failAt = new Set<string>();
  /** 卡在这一步，直到 `release`；`honorAbort` 时收到中止就以异常结束。 */
  holdAt: string | null = null;
  honorAbort = true;
  reusable = true;
  /** 第三步额外开几个子任务。 */
  fanOut = 0;
  #release: (() => void) | null = null;
  #reached: (() => void) | null = null;
  reached: Promise<void> = Promise.resolve();

  hold(step: string, honorAbort = true): void {
    this.holdAt = step;
    this.honorAbort = honorAbort;
    this.reached = new Promise((resolve) => {
      this.#reached = resolve;
    });
  }

  release(): void {
    this.holdAt = null;
    this.#release?.();
  }

  async step(name: string, signal: AbortSignal): Promise<void> {
    this.runs.push(name);
    if (this.holdAt === name) {
      await new Promise<void>((resolve, reject) => {
        this.#release = resolve;
        if (this.honorAbort) signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        this.#reached?.();
      });
    }
    if (this.failAt.has(name)) throw new PipelineStepError('FAKE_FAILED', `${name} 失败了`, { injected: true });
  }
}

function fakePipeline(control: FakeControl): PipelineDefinition<FakeParams> {
  const step =
    (name: string) =>
    async ({
      signal,
      params,
      outputs,
      progress,
    }: Parameters<PipelineDefinition<FakeParams>['steps'][number]['run']>[0]): Promise<StepResult> => {
      progress({ done: 0, total: 1, unit: 'units', calls: { calls: 1, retries: 0, failures: 0 } }, 'generating');
      await control.step(name, signal);
      return { output: { name, value: params.value, seen: Object.keys(outputs) } };
    };
  return {
    name: 'fake',
    label: '假流程',
    description: '测试用',
    paramsSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
    parse(raw) {
      if (typeof raw.value !== 'string') throw new RpcError('invalid-request', 'value 应为字符串');
      return { value: raw.value };
    },
    async prepare(params) {
      return { params, providerId: 'test', modelId: 'test', videoId: null, contentHash: `sha256:${'0'.repeat(64)}` };
    },
    steps: [
      { name: 'a', label: '第一步', run: step('a'), reusable: async () => control.reusable },
      { name: 'b', label: '第二步', run: step('b') },
      {
        name: 'c',
        label: '第三步',
        run: async (context) => {
          for (let i = 0; i < control.fanOut; i++) await context.spawn(`片段 ${i + 1}`, async () => i);
          return step('c')(context);
        },
      },
      { name: 'd', label: '可选的一步', when: (params) => params.value === 'with-d', run: step('d') },
    ],
    async complete({ outputs }) {
      return { summary: { steps: Object.keys(outputs) }, result: { documentId: null, artifactId: `sha256:${'1'.repeat(64)}` } };
    },
  };
}

describe('PipelineRunner', () => {
  let dir: string;
  let jobs: JobManager;
  let runner: PipelineRunner;
  let control: FakeControl;
  let events: JobRecord[];

  async function open(limits: Pick<JobManagerOptions, 'maxRetainedJobs' | 'maxRetainedRetryablePipelines'> = {}): Promise<void> {
    jobs = testJobManager(dir, {}, limits);
    await jobs.open();
    runner = new PipelineRunner({ jobs, stagingDir: path.join(dir, 'staging'), definitions: [fakePipeline(control)] });
    await runner.open();
    events = [];
    jobs.onChange((job) => events.push(job));
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-pipelines-'));
    control = new FakeControl();
    await open();
  });

  afterEach(async () => {
    control.release();
    await runner.idle();
    await jobs.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const start = (value = 'v', commandId?: string) =>
    runner.start({ pipeline: 'fake', params: { value }, ...(commandId ? { commandId } : {}) }, { kind: 'connection', id: 'conn_1' });

  async function finished(jobId: string): Promise<JobRecord> {
    await jobs.settled(jobId);
    await runner.idle();
    return jobs.inspect(jobId);
  }

  const children = (jobId: string) =>
    jobs
      .list()
      .filter((r) => r.parentJobId === jobId)
      .reverse();

  it('按顺序执行各步，父任务按步骤报告进度，子任务记下父任务与提交者', async () => {
    const { jobId } = await start();
    const parent = await finished(jobId);
    expect(control.runs).toEqual(['a', 'b', 'c']);
    expect(parent).toMatchObject({
      kind: 'pipeline',
      state: 'completed',
      submitter: { kind: 'connection', id: 'conn_1' },
      providerId: 'test',
      result: { documentId: null },
      progress: { done: 4, total: 4, unit: 'steps' },
      pipeline: { name: 'fake', params: { value: 'v' }, current: null, stoppedAt: null, summary: { steps: ['a', 'b', 'c', 'd'] } },
    });
    expect(parent.pipeline!.steps.map((s) => s.status)).toEqual(['completed', 'completed', 'completed', 'skipped']);
    // 后面的步骤看得到前面的产出。
    expect(parent.pipeline!.steps[2]!.output).toMatchObject({ seen: ['a', 'b'] });

    const steps = children(jobId);
    expect(steps.map((s) => s.step?.name)).toEqual(['a', 'b', 'c']);
    for (const [index, child] of steps.entries()) {
      expect(child).toMatchObject({
        kind: 'pipeline-step',
        state: 'completed',
        parentJobId: jobId,
        submitter: { kind: 'pipeline', id: jobId },
        step: { pipeline: 'fake', index },
      });
      expect(parent.pipeline!.steps[index]!.jobId).toBe(child.jobId);
    }

    // 父任务的进度一步一步往前走，阶段与调用计数跟着正在执行的那一步。
    const parentEvents = events.filter((e) => e.jobId === jobId);
    const done = [...new Set(parentEvents.map((e) => e.progress?.done))];
    expect(done).toEqual([0, 1, 2, 3, 4]);
    expect(parentEvents.some((e) => e.phase === 'generating' && e.progress?.calls?.calls === 1)).toBe(true);
  });

  it('可选步骤按参数执行', async () => {
    const { jobId } = await start('with-d');
    const parent = await finished(jobId);
    expect(control.runs).toEqual(['a', 'b', 'c', 'd']);
    expect(parent.pipeline!.steps[3]!.status).toBe('completed');
  });

  it('一步可以多开子任务，挂在同一个父任务与步骤下', async () => {
    control.fanOut = 2;
    const { jobId } = await start();
    await finished(jobId);
    const extra = children(jobId).filter((c) => c.step?.name === 'c');
    expect(extra.map((c) => c.step?.label)).toEqual(['第三步', '第三步：片段 1', '第三步：片段 2']);
    expect(extra.every((c) => c.state === 'completed' && c.submitter.kind === 'pipeline')).toBe(true);
  });

  it('参数不合与没有的流程在启动时拒绝；同一个 commandId 只启动一次', async () => {
    await expect(runner.start({ pipeline: 'nope', params: {} }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(runner.start({ pipeline: 'fake', params: { value: 1 } }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({
      code: 'invalid-request',
    });
    const first = await start('v', 'cmd_same');
    const second = await start('v', 'cmd_same');
    expect(second.jobId).toBe(first.jobId);
    await finished(first.jobId);
    expect(runner.list()).toEqual([
      expect.objectContaining({
        name: 'fake',
        steps: [
          { name: 'a', label: '第一步', optional: false },
          { name: 'b', label: '第二步', optional: false },
          { name: 'c', label: '第三步', optional: false },
          { name: 'd', label: '可选的一步', optional: true },
        ],
      }),
    ]);
  });

  it('一步失败时停在这一步：之前的保留，之后的不执行；重试从这一步开始并复用之前的产出', async () => {
    control.failAt.add('b');
    const { jobId } = await start();
    const failed = await finished(jobId);
    expect(control.runs).toEqual(['a', 'b']);
    expect(failed).toMatchObject({
      state: 'failed',
      error: { code: 'FAKE_FAILED', details: { injected: true, step: 'b' } },
      pipeline: { stoppedAt: 'b', current: null },
    });
    expect(failed.pipeline!.steps.map((s) => s.status)).toEqual(['completed', 'failed', 'pending', 'pending']);
    const failedChild = jobs.inspect(failed.pipeline!.steps[1]!.jobId!);
    expect(failedChild).toMatchObject({ state: 'failed', error: { code: 'FAKE_FAILED' } });
    // 失败的流程的 staging 保留供重试。
    await expect(fs.stat(path.join(dir, 'staging', 'pipelines', jobId))).resolves.toBeTruthy();

    control.failAt.clear();
    control.runs = [];
    expect(await runner.retry(jobId)).toEqual({ jobId });
    const retried = await finished(jobId);
    expect(control.runs).toEqual(['b', 'c']);
    expect(retried).toMatchObject({ state: 'completed', attempt: 2, error: null });
    expect(retried.pipeline!.steps[0]).toEqual(failed.pipeline!.steps[0]);
    expect(retried.pipeline!.steps[1]).toMatchObject({ status: 'completed', attempts: 2 });
    expect(retried.pipeline!.steps[1]!.jobId).not.toBe(failed.pipeline!.steps[1]!.jobId);
    // 旧的子任务保留在列表里。
    expect(jobs.inspect(failedChild.jobId).state).toBe('failed');
    await expect(fs.stat(path.join(dir, 'staging', 'pipelines', jobId))).rejects.toThrow();

    // 完成的流程不能重试。
    await expect(runner.retry(jobId)).rejects.toMatchObject({ code: 'conflict', details: { code: 'JOB_NOT_RETRYABLE' } });
  });

  it('账本的上限只数顶层任务：子任务随父任务保留与淘汰；还能重试的流程另外保留，有上界', async () => {
    await runner.idle();
    await jobs.shutdown();
    await open({ maxRetainedJobs: 2, maxRetainedRetryablePipelines: 1 });
    control.failAt.add('b');
    const failedOld = (await start('f1')).jobId;
    await finished(failedOld);
    const failedNew = (await start('f2')).jobId;
    await finished(failedNew);
    control.failAt.clear();
    const done: string[] = [];
    for (const value of ['c1', 'c2', 'c3']) {
      const { jobId } = await start(value);
      await finished(jobId);
      done.push(jobId);
    }
    // 终结的顶层任务：两个失败的流程与三个完成的流程。最新的失败流程另外保留；其余的按结束时间留最新的两条。
    const parents = jobs.list().filter((r) => r.parentJobId == null);
    expect(new Set(parents.map((r) => r.jobId))).toEqual(new Set([failedNew, done[1], done[2]]));
    // 子任务不计数，跟着父任务：留下的流程的步骤都在，淘汰的流程的步骤一起删了。
    expect(children(failedNew)).toHaveLength(2);
    expect(children(done[1]!)).toHaveLength(3);
    expect(children(done[2]!)).toHaveLength(3);
    expect(children(failedOld)).toHaveLength(0);
    expect(children(done[0]!)).toHaveLength(0);
    expect(jobs.list()).toHaveLength(3 + 2 + 3 + 3);
    // 保留下来的失败流程还能重试；淘汰的不能。
    await expect(runner.retry(failedOld)).rejects.toMatchObject({ code: 'not-found' });
    expect(await runner.retry(failedNew)).toEqual({ jobId: failedNew });
    expect((await finished(failedNew)).state).toBe('completed');
    // 重试完成后它成了普通的完成记录，按结束时间它最新：淘汰的是更旧的那条完成记录。
    expect(
      new Set(
        jobs
          .list()
          .filter((r) => r.parentJobId == null)
          .map((r) => r.jobId),
      ),
    ).toEqual(new Set([failedNew, done[2]]));
  });

  it('一看到失败的事件就重试：等这次执行收尾之后重试，不拒绝', async () => {
    control.failAt.add('b');
    const { jobId } = await start();
    await new Promise<void>((resolve) => {
      jobs.onChange((job) => {
        if (job.jobId === jobId && job.state === 'failed') resolve();
      });
    });
    control.failAt.clear();
    expect(await runner.retry(jobId)).toEqual({ jobId });
    expect(await finished(jobId)).toMatchObject({ state: 'completed', attempt: 2 });
  });

  it('之前的产出不能再用时重试从那一步重来', async () => {
    control.failAt.add('c');
    const { jobId } = await start();
    await finished(jobId);
    control.failAt.clear();
    control.reusable = false;
    control.runs = [];
    await runner.retry(jobId);
    await finished(jobId);
    expect(control.runs).toEqual(['a', 'b', 'c']);
  });

  it('取消先挡住新步骤：正在执行的那一步做完了也不再开始下一步', async () => {
    control.hold('a', false);
    const { jobId } = await start();
    await control.reached;
    const cancelling = jobs.cancel(jobId);
    control.release();
    expect(await cancelling).toEqual({ state: 'cancelled' });
    const parent = await finished(jobId);
    expect(control.runs).toEqual(['a']);
    expect(parent).toMatchObject({ state: 'cancelled', error: null, pipeline: { stoppedAt: 'b' } });
    expect(parent.pipeline!.steps.map((s) => s.status)).toEqual(['completed', 'pending', 'pending', 'pending']);
    expect(children(jobId).map((c) => c.state)).toEqual(['completed']);
    await expect(fs.stat(path.join(dir, 'staging', 'pipelines', jobId))).rejects.toThrow();
  });

  it('取消中止正在执行的那一步；取消子任务等于取消整个流程；被取消的流程可以重试', async () => {
    control.hold('b');
    const { jobId } = await start();
    await control.reached;
    const child = children(jobId)[1]!;
    expect(await jobs.cancel(child.jobId)).toEqual({ state: 'cancelled' });
    const parent = await finished(jobId);
    expect(parent).toMatchObject({ state: 'cancelled', pipeline: { stoppedAt: 'b' } });
    expect(parent.pipeline!.steps.map((s) => s.status)).toEqual(['completed', 'cancelled', 'pending', 'pending']);

    control.release();
    control.runs = [];
    await runner.retry(jobId);
    expect((await finished(jobId)).state).toBe('completed');
    expect(control.runs).toEqual(['b', 'c']);
  });

  it('Runtime 停止时流程与正在执行的那一步标为中断，重启后可以从那一步重试', async () => {
    control.hold('b');
    const { jobId } = await start();
    await control.reached;
    await jobs.shutdown();
    await runner.idle();
    const stopped = jobs.inspect(jobId);
    expect(stopped).toMatchObject({
      state: 'interrupted',
      error: { code: 'JOB_INTERRUPTED', details: { step: 'b' } },
      pipeline: { stoppedAt: 'b' },
    });
    expect(stopped.pipeline!.steps.map((s) => s.status)).toEqual(['completed', 'interrupted', 'pending', 'pending']);

    control = new FakeControl();
    await open();
    const reopened = jobs.inspect(jobId);
    expect(reopened.state).toBe('interrupted');
    await runner.retry(jobId);
    expect((await finished(jobId)).state).toBe('completed');
    expect(control.runs).toEqual(['b', 'c']);
  });

  it('进程没有正常停止时，重启后没有终结的流程标为中断并记下停在哪一步', async () => {
    // 第二步永远不结束，也不理会中止：模拟进程直接退出。
    control.hold('b', false);
    const { jobId } = await start();
    await control.reached;
    // 等账本写下「第二步在执行」（落盘带 fsync，时长不定）；旧的 JobManager 与流程就此丢下，不再写账本。
    await vi.waitFor(
      async () => {
        const ledger = { jobs: await new JobLedger(path.join(dir, 'store', 'jobs.jsonl')).load() };
        const steps = ledger.jobs.find((job) => job.record.jobId === jobId)?.record.pipeline?.steps ?? [];
        expect(steps.map((s) => s.status).slice(0, 2)).toEqual(['completed', 'running']);
      },
      { timeout: 5000, interval: 20 },
    );
    control = new FakeControl();
    await open();
    const record = jobs.inspect(jobId);
    expect(record).toMatchObject({
      state: 'interrupted',
      error: { code: 'JOB_INTERRUPTED', details: { step: 'b' } },
      pipeline: { current: null, stoppedAt: 'b' },
    });
    expect(record.pipeline!.steps.map((s) => s.status)).toEqual(['completed', 'interrupted', 'pending', 'pending']);
    expect(
      jobs
        .list()
        .filter((r) => r.parentJobId === jobId)
        .map((r) => r.state),
    ).toEqual(['interrupted', 'completed']);
    await runner.retry(jobId);
    expect((await finished(jobId)).state).toBe('completed');
    expect(control.runs).toEqual(['b', 'c']);
  });
});
