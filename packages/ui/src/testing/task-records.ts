import type { JobRecord, TaskSummary } from '@baocut/protocol';

/** 任务表测试共用的记录。 */
export function job(patch: Partial<JobRecord> & Pick<JobRecord, 'jobId'>): JobRecord {
  return {
    kind: 'transcribe',
    state: 'running',
    phase: 'transcribing',
    progress: null,
    videoId: 'v1',
    assetId: 'a1',
    assetRevision: '1',
    contentHash: 'sha256:0',
    providerId: 'local',
    modelId: 'whisper-large-v3',
    bundleId: 'whisper-large-v3',
    inputHash: 'sha256:1',
    submitter: { kind: 'connection', id: 'conn1' },
    attempt: 1,
    createdAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-01T09:00:00Z',
    startedAt: '2026-10-01T09:00:00Z',
    endedAt: null,
    error: null,
    result: null,
    warnings: [],
    ...patch,
  };
}

export function task(patch: Partial<TaskSummary> & Pick<TaskSummary, 'taskId'>): TaskSummary {
  return {
    conversationId: 'c1',
    conversationTitle: '',
    projectId: null,
    goal: patch.taskId,
    status: 'running',
    startedAt: '2026-10-01T09:00:00Z',
    endedAt: null,
    error: null,
    ...patch,
  };
}
