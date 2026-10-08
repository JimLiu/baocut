import { describe, expect, it } from 'vitest';
import type { ApplicationRecord, GenerationParameters } from '@baocut/protocol';
import { job } from '../testing/task-records.ts';
import { chargesOnRetry, reconcileOptions } from './task-reconcile.ts';

const speech: GenerationParameters = {
  capability: 'synthesizeSpeech',
  text: '你好',
  voice: 'alloy',
  language: null,
  format: 'mp3',
  instructions: null,
  speed: null,
  seed: null,
};

function application(state: ApplicationRecord['state']): ApplicationRecord {
  return {
    applicationId: 'ap1',
    jobId: 'j1',
    artifactIds: ['art1'],
    videoId: 'v1',
    targetRefs: ['a1'],
    baseVideoRevision: null,
    commandId: null,
    state,
    receipt: null,
    error: null,
    createdAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-01T09:00:00Z',
  };
}

const ENDED = '2026-10-01T09:10:00Z';

describe('对账决定（照 Runtime 的 reconcileChoices）', () => {
  it('崩溃后正在自动重跑的（interrupted、没有 endedAt）还没结束，不给决定', () => {
    expect(reconcileOptions(job({ jobId: 'j1', state: 'interrupted', endedAt: null }))).toEqual([]);
  });

  it('结果不明：生成任务可以再试或放弃；中断的只能再试', () => {
    const base = { jobId: 'j1', kind: 'synthesizeSpeech' as const, providerId: 'openai', videoId: null, generation: speech };
    expect(reconcileOptions(job({ ...base, state: 'needs-reconciliation' }))).toEqual(['retry', 'discard']);
    expect(reconcileOptions(job({ ...base, state: 'interrupted', endedAt: ENDED }))).toEqual(['retry']);
  });

  it('转写要有视频才能再试；固定流程的一步与远端节点提交的不能', () => {
    expect(reconcileOptions(job({ jobId: 'j1', state: 'interrupted', endedAt: ENDED }))).toEqual(['retry']);
    expect(reconcileOptions(job({ jobId: 'j1', state: 'interrupted', endedAt: ENDED, videoId: null }))).toEqual([]);
    expect(reconcileOptions(job({ jobId: 'j1', state: 'interrupted', endedAt: ENDED, parentJobId: 'p1' }))).toEqual([]);
    expect(reconcileOptions(job({ jobId: 'j1', state: 'needs-reconciliation', submitter: { kind: 'node', id: 'n1' } }))).toEqual(['discard']);
  });

  it('重新写入：失败或取消、产物在、最近一次应用没有提交', () => {
    const done = { jobId: 'j1', result: { documentId: null, artifactId: 'art1' } };
    expect(reconcileOptions(job({ ...done, state: 'failed', applications: [application('stale-input')] }))).toEqual(['apply']);
    expect(reconcileOptions(job({ ...done, state: 'cancelled', applications: [application('committed'), application('cancelled')] }))).toEqual([
      'apply',
    ]);
    expect(reconcileOptions(job({ ...done, state: 'failed', applications: [application('committed')] }))).toEqual([]);
    expect(reconcileOptions(job({ ...done, state: 'failed' }))).toEqual([]);
    expect(reconcileOptions(job({ jobId: 'j1', state: 'failed', applications: [application('rejected')] }))).toEqual([]);
  });

  it('完成、在跑的任务没有可做的决定', () => {
    expect(reconcileOptions(job({ jobId: 'j1', state: 'completed' }))).toEqual([]);
    expect(reconcileOptions(job({ jobId: 'j1', state: 'running' }))).toEqual([]);
  });

  it('只有在线与智能体 Provider 重试会再计费', () => {
    expect(chargesOnRetry({ providerId: 'openai' })).toBe(true);
    expect(chargesOnRetry({ providerId: 'agent:codex' })).toBe(true);
    expect(chargesOnRetry({ providerId: 'local' })).toBe(false);
    expect(chargesOnRetry({ providerId: 'node:mac-mini' })).toBe(false);
  });
});
