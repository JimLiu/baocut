import { describe, expect, it } from 'vitest';
import type { JobRecord } from '@baocut/protocol';
import { useJobs } from './jobs-store.ts';

const exporting = (jobId: string, done: number, at: string): JobRecord =>
  ({
    jobId,
    kind: 'export',
    state: 'running',
    phase: 'generating',
    progress: { done, total: 100, unit: 'frames' },
    updatedAt: at,
  }) as JobRecord;

describe('任务镜像', () => {
  it('job.removed：账本淘汰的任务从镜像里删掉，速度样本一起丢；别的任务不动', () => {
    const kept = { jobId: 'job_keep', kind: 'transcribe', state: 'completed' } as JobRecord;
    useJobs.getState().replace({ jobs: [kept] });
    useJobs.getState().apply({ type: 'job.updated', job: exporting('job_old', 10, '2026-10-18T00:00:00.000Z') });
    useJobs.getState().apply({ type: 'job.updated', job: exporting('job_old', 40, '2026-10-18T00:00:02.000Z') });
    expect(Object.keys(useJobs.getState().speeds)).toEqual(['job_old']);

    useJobs.getState().apply({ type: 'job.removed', jobIds: ['job_old', 'job_gone'] });
    expect(useJobs.getState().jobs).toEqual([kept]);
    expect(useJobs.getState().speeds).toEqual({});

    // 一个都不在：引用不变。
    const before = useJobs.getState();
    useJobs.getState().apply({ type: 'job.removed', jobIds: ['job_none'] });
    expect(useJobs.getState().jobs).toBe(before.jobs);
    expect(useJobs.getState().speeds).toBe(before.speeds);
  });
});
