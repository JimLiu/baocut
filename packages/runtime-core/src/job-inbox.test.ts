import { afterEach, describe, expect, it, vi } from 'vitest';
import { silentLogger, type JobFinished } from '@baocut/harness';
import type { JobRecord } from '@baocut/protocol';
import { JobTools, type JobToolsDeps } from './agent-tools/job-tools.ts';
import type { ToolPrincipal } from './agent-tools/tool-scope.ts';
import { JobInbox } from './job-inbox.ts';

/** 完成收件箱（架构设计 §7.2）：哪些结束交给 Harness、看过的不交、每次结束只交一次。假的任务管理器与 Harness。 */

function record(over: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId: 'job_1',
    kind: 'music',
    state: 'completed',
    attempt: 1,
    videoId: null,
    submitter: { kind: 'agent', id: 'conv_1', taskId: 'task_1' },
    warnings: [],
    ...over,
  } as JobRecord;
}

function setup() {
  let listener: ((job: JobRecord) => void) | null = null;
  const jobs = {
    onChange: (l: (job: JobRecord) => void) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  const delivered: JobFinished[] = [];
  const harness = { jobFinished: async (job: JobFinished) => (delivered.push(job), 'woke' as const) };
  const inbox = new JobInbox({ jobs, harness, log: silentLogger, delayMs: 100 });
  return { inbox, delivered, emit: (job: JobRecord) => listener?.(job), subscribed: () => listener !== null };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('JobInbox', () => {
  it('智能体提交的顶层 Job 完成或失败：等一会儿交给 Harness，每次结束只交一次；重跑是新的一次', async () => {
    vi.useFakeTimers();
    const { emit, delivered } = setup();
    emit(record({ state: 'running' }));
    emit(record());
    emit(record());
    expect(delivered).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(delivered).toEqual([
      { conversationId: 'conv_1', taskId: 'task_1', jobId: 'job_1', kind: 'music', attempt: 1, state: 'completed' },
    ]);
    emit(record({ state: 'failed', attempt: 2 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(delivered.map((j) => [j.attempt, j.state])).toEqual([
      [1, 'completed'],
      [2, 'failed'],
    ]);
  });

  it('固定流程里的一步、不是智能体提交的、取消与中断的都不交', async () => {
    vi.useFakeTimers();
    const { emit, delivered } = setup();
    emit(record({ jobId: 'step', parentJobId: 'job_p' }));
    emit(record({ jobId: 'user', submitter: { kind: 'connection', id: 'ui' } }));
    emit(record({ jobId: 'c', state: 'cancelled' }));
    emit(record({ jobId: 'i', state: 'interrupted' }));
    emit(record({ jobId: 'n', state: 'needs-reconciliation' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(delivered).toEqual([]);
  });

  it('智能体用 jobs_inspect / jobs_wait 看到了终态就不交；看的是别的会话、或还没结束时看的不算', async () => {
    vi.useFakeTimers();
    const { inbox, emit, delivered } = setup();
    const tools = (job: JobRecord) =>
      new JobTools({
        jobs: {},
        pipelines: {},
        scope: { authorize: () => ({}), visibleJob: async () => job },
        seen: (r: JobRecord) => inbox.markSeen(r),
      } as unknown as JobToolsDeps);
    const agent = (conversationId: string) => ({ kind: 'agent', conversationId }) as unknown as ToolPrincipal;

    await tools(record({ state: 'running' })).dispatch('jobs_inspect', { jobId: 'job_1' }, agent('conv_1'));
    await tools(record()).dispatch('jobs_inspect', { jobId: 'job_1' }, agent('conv_2'));
    emit(record());
    await tools(record({ jobId: 'job_2' })).dispatch('jobs_inspect', { jobId: 'job_2' }, agent('conv_1'));
    emit(record({ jobId: 'job_2' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(delivered.map((j) => j.jobId)).toEqual(['job_1']);
  });

  it('关闭后退订，等着交的不再交', async () => {
    vi.useFakeTimers();
    const { inbox, emit, delivered, subscribed } = setup();
    emit(record());
    inbox.close();
    expect(subscribed()).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(delivered).toEqual([]);
  });
});
