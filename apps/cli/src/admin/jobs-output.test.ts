import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, type ApplicationRecord, type JobRecord } from '@baocut/protocol';
import { describeCancellation, formatReconcileResult, jobStateLabel, parseJobsArgs } from './jobs-output.ts';

function job(patch: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job_1',
    kind: 'synthesizeSpeech',
    state: 'completed',
    phase: 'done',
    progress: null,
    videoId: 'mov_1',
    assetId: null,
    providerId: 'openai',
    submitter: { kind: 'connection', id: 'conn_1' },
    attempt: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    error: null,
    result: null,
    warnings: [],
    ...patch,
  } as JobRecord;
}

function app(patch: Partial<ApplicationRecord>): ApplicationRecord {
  return {
    applicationId: 'app_1',
    jobId: 'job_1',
    artifactIds: ['sha256:a'],
    videoId: 'mov_1',
    targetRefs: ['output1'],
    baseVideoRevision: '3',
    commandId: 'cmd_app_1_1',
    state: 'committed',
    receipt: null,
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('baocut jobs 的参数', () => {
  it('resources；reconcile 要任务与三种决定之一', () => {
    expect(parseJobsArgs(['resources'])).toEqual({ kind: 'resources' });
    expect(() => parseJobsArgs([])).toThrow(/用法/);
    expect(parseJobsArgs(['reconcile', 'job_1', 'retry'])).toEqual({ kind: 'reconcile', jobId: 'job_1', decision: 'retry' });
    expect(parseJobsArgs(['reconcile', 'job_1', 'discard'])).toMatchObject({ decision: 'discard' });
    expect(parseJobsArgs(['reconcile', 'job_1', 'apply'])).toMatchObject({ decision: 'apply' });
    expect(() => parseJobsArgs(['reconcile', 'job_1'])).toThrow(/用法/);
    expect(() => parseJobsArgs(['reconcile'])).toThrow(/用法/);
    expect(() => parseJobsArgs(['reconcile', 'job_1', 'retry', 'extra'])).toThrow(/用法/);
    expect(() => parseJobsArgs(['cancel', 'job_1'])).toThrow(/用法/);
    expect(() => parseJobsArgs(['reconcile', 'job_1', 'commit'])).toThrow(/retry、discard、apply/);
  });
});

describe('baocut jobs 的输出', () => {
  it('状态名', () => {
    expect(jobStateLabel('needs-reconciliation')).toBe('待对账');
    expect(jobStateLabel('interrupted')).toBe('中断');
  });

  it('取消的三件事实分开写', () => {
    expect(describeCancellation({ requestedAt: 'x', localStoppedAt: 'y', remote: 'cancel-unsupported', cost: 'possible' })).toBe(
      '本地已停、远端不能取消、可能已计费',
    );
    expect(describeCancellation({ requestedAt: 'x', localStoppedAt: null, remote: 'unknown', cost: 'none' })).toBe(
      '本地未停、远端不明、无费用',
    );
  });

  it('对账之后的结果', () => {
    expect(formatReconcileResult('retry', job({ state: 'queued', attempt: 2 }))).toEqual([
      '已重新排队（第 2 次尝试）：job_1',
      '状态：排队',
    ]);
    expect(
      formatReconcileResult(
        'discard',
        job({
          state: 'cancelled',
          cancellation: { requestedAt: 'x', localStoppedAt: 'y', remote: 'unknown', cost: 'possible' },
          grant: {
            grantId: 'grt_1',
            generation: 1,
            reservationId: 'rsv_1',
            budgetMode: 'per-call-unknown-cost',
            dataKinds: ['transcript'],
            reserved: { calls: 1, amount: null },
            settled: { calls: 1, amount: null, basis: 'conservative', at: 'x' },
          },
        }),
      ),
    ).toEqual(['已放弃：job_1', '状态：已取消', '取消：本地已停、远端不明、可能已计费', '预算结算：conservative，1 次调用']);
    expect(
      formatReconcileResult('apply', job({ applications: [app({ receipt: { transactionId: 't', videoRevision: '4', refs: {} } })] })),
    ).toEqual(['已应用到视频 mov_1', '状态：已完成']);
    expect(
      formatReconcileResult(
        'apply',
        job({ applications: [app({ receipt: { transactionId: 't', videoRevision: '4', refs: {}, recovered: true } })] }),
      )[0],
    ).toBe('已应用到视频 mov_1（上次其实已经提交，补记了回执）');
    expect(
      formatReconcileResult(
        'apply',
        job({
          state: 'failed',
          error: { code: 'STALE_JOB_INPUT', message: '' },
          applications: [app({ state: 'stale-input', error: { code: 'STALE_JOB_INPUT', message: '视频已经关闭' } })],
        }),
      ),
    ).toEqual(['没有应用成功：目标已变（视频已经关闭）', '状态：失败  STALE_JOB_INPUT']);
  });
});

describe('英文', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('状态、取消与对账的提示是英文', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(jobStateLabel('needs-reconciliation')).toBe('Needs reconciling');
    expect(() => parseJobsArgs(['reconcile', 'job_1', 'maybe'])).toThrow('Reconcile decision must be one of: retry, discard, apply');
    expect(describeCancellation({ requestedAt: '2026-01-01T00:00:00.000Z', localStoppedAt: '2026-01-01T00:00:00.000Z', remote: 'cancelled', cost: 'possible' })).toBe(
      'stopped locally, cancelled remotely, may have been charged',
    );
    expect(formatReconcileResult('discard', job({}))).toEqual(['Discarded: job_1', 'Status: Done']);
  });
});
