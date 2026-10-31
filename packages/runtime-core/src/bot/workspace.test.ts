import { describe, expect, it } from 'vitest';
import type { JobRecord, UsageRecord, VideoVersionList, WorkItem } from '@baocut/protocol';
import { runtimeWorkspace } from './workspace.ts';

const since = '2026-10-01T00:00:00.000Z';
const item = { threadId: 'conv_thread', resources: [{ kind: 'video', projectId: 'p1', videoId: 'v1' }] } as unknown as WorkItem;

function workspace(versions: () => Promise<VideoVersionList>, jobs: Record<string, JobRecord> = {}) {
  return runtimeWorkspace({
    projects: () => [],
    videos: () => [
      { entryId: 'e1', dir: '/p/v1', projectId: 'p1', videoId: 'v1', lastActivityAt: since },
      { entryId: 'e2', dir: '/p/v2', projectId: 'p1', videoId: 'v2', lastActivityAt: since },
    ],
    job: (id) => jobs[id],
    versions,
  });
}

const list = (version: number, toRevision: string, updatedAt: string, conversation = 'conv_other') =>
  ({ versions: [{ version, toRevision, updatedAt, conversations: [{ id: conversation }] }], unreadable: [] }) as unknown as VideoVersionList;

describe('video-version evidence', () => {
  const evidence = (version: string) => ({ kind: 'video-version' as const, projectId: 'p1', videoId: 'v1', version });

  it('accepts only the newest version made after the task started', async () => {
    const ws = workspace(async () => list(7, 'r42', '2026-10-02T00:00:00.000Z'));
    expect(await ws.verifyEvidence(evidence('7'), item, since)).toBeNull();
    expect(await ws.verifyEvidence(evidence('r42'), item, since)).toBeNull();
    expect(await ws.verifyEvidence(evidence('99'), item, since)).toMatch(/is at version 7/);
  });

  it('rejects a version older than the task, and when versions cannot be read', async () => {
    expect(await workspace(async () => list(7, 'r42', '2026-09-01T00:00:00.000Z')).verifyEvidence(evidence('7'), item, since)).toMatch(/older/);
    expect(
      await workspace(async () => {
        throw new Error('closed');
      }).verifyEvidence(evidence('7'), item, since),
    ).toMatch(/could not read/);
  });
});

describe('evidence must belong to the task (§7.5)', () => {
  const done = (videoId: string | null, submitter: string, kind = 'export') =>
    ({ kind, state: 'completed', attempt: 1, createdAt: '2026-10-02T00:00:00.000Z', videoId, submitter: { kind: 'agent', id: submitter, taskId: 't' } }) as unknown as JobRecord;
  const jobs = { own: done('v2', 'conv_thread'), onVideo: done('v1', 'conv_other'), stray: done('v2', 'conv_other'), transcript: done('v1', 'conv_thread', 'transcribe') };
  const ws = workspace(async () => list(3, 'r3', '2026-10-02T00:00:00.000Z'), jobs);

  it('accepts a job the thread ran or one on the task video, and rejects a job from another conversation on another video', async () => {
    expect(await ws.verifyEvidence({ kind: 'job', jobId: 'own', attempt: 1 }, item, since)).toBeNull();
    expect(await ws.verifyEvidence({ kind: 'job', jobId: 'onVideo', attempt: 1 }, item, since)).toBeNull();
    expect(await ws.verifyEvidence({ kind: 'job', jobId: 'stray', attempt: 1 }, item, since)).toMatch(/not run by this task/);
    expect(await ws.verifyEvidence({ kind: 'export', projectId: 'p1', exportId: 'stray', videoId: 'v2' }, item, since)).toMatch(/not made by this task/);
  });

  it('accepts export evidence only for an export job, not another kind of job on the task video', async () => {
    expect(await ws.verifyEvidence({ kind: 'export', projectId: 'p1', exportId: 'onVideo', videoId: 'v1' }, item, since)).toBeNull();
    expect(await ws.verifyEvidence({ kind: 'export', projectId: 'p1', exportId: 'transcript', videoId: 'v1' }, item, since)).toMatch(/not an export/);
    // 同一个 Job 当作普通 Job 证据仍然算数。
    expect(await ws.verifyEvidence({ kind: 'job', jobId: 'transcript', attempt: 1 }, item, since)).toBeNull();
  });

  it('accepts a new version of a task video or one the thread made, and rejects another video changed elsewhere', async () => {
    const v = (videoId: string) => ({ kind: 'video-version' as const, projectId: 'p1', videoId, version: '3' });
    expect(await ws.verifyEvidence(v('v1'), item, since)).toBeNull();
    expect(await ws.verifyEvidence(v('v2'), item, since)).toMatch(/not one of this task's videos/);
    const mine = workspace(async () => list(3, 'r3', '2026-10-02T00:00:00.000Z', 'conv_thread'));
    expect(await mine.verifyEvidence(v('v2'), item, since)).toBeNull();
  });
});

describe('channel spend from the usage ledger', () => {
  const record = (at: string, amount: string | null, ref: { conversationId?: string; jobId?: string }) =>
    ({
      at,
      providerId: 'openai',
      accountId: null,
      capability: 'text',
      modelId: 'm',
      source: 'agent-tool',
      ref,
      units: {},
      cost: amount ? { kind: 'reported', amount, currency: 'USD' } : { kind: 'unknown' },
      durationMs: 1,
      status: 'ok',
    }) as unknown as UsageRecord;

  it('adds up reported costs of the channel conversations and their agent jobs, for the day and the month', async () => {
    const ws = runtimeWorkspace({
      projects: () => [],
      videos: () => [],
      job: (jobId) => (jobId === 'job_t' ? ({ submitter: { kind: 'agent', id: 'conv_thread', taskId: 't' } } as JobRecord) : undefined),
      versions: async () => list(1, 'r1', since),
      usage: async () => [
        record('2026-10-31T09:00:00.000Z', '1.25', { conversationId: 'conv_thread' }),
        record('2026-10-31T10:00:00.000Z', '0.50', { jobId: 'job_t' }),
        record('2026-10-31T10:00:00.000Z', '9.00', { conversationId: 'conv_other' }),
        record('2026-10-31T10:00:00.000Z', null, { conversationId: 'conv_thread' }),
        record('2026-10-12T10:00:00.000Z', '2.00', { conversationId: 'conv_channel' }),
        record('2026-09-30T10:00:00.000Z', '5.00', { conversationId: 'conv_channel' }),
      ],
    });
    const spend = await ws.channelSpend!(new Set(['conv_channel', 'conv_thread']), { day: '2026-10-31T00:00:00.000Z', month: '2026-10-01T00:00:00.000Z' });
    expect(spend).toEqual({
      day: [{ amount: '1.75', currency: 'USD' }],
      month: [{ amount: '3.75', currency: 'USD' }],
      // 每个会话从开始累计（上个月的也算），Job 记在提交它的会话名下。
      byConversation: { conv_thread: [{ amount: '1.75', currency: 'USD' }], conv_channel: [{ amount: '7.00', currency: 'USD' }] },
    });
  });

  it('is not offered without a ledger', () => {
    expect(workspace(async () => list(1, 'r1', since)).channelSpend).toBeUndefined();
  });
});

describe('jobs a thread waits for', () => {
  const job = (state: JobRecord['state']) => ({ state, kind: 'dub' }) as unknown as JobRecord;
  const ws = workspace(async () => list(1, 'r1', since), { done: job('completed'), failed: job('failed'), running: job('running'), hung: job('interrupted') });

  it('are finished once each one completed, failed or is no longer known; running and hung ones are not', async () => {
    expect(await ws.jobsFinished!(['done', 'failed', 'gone'])).toBe(true);
    expect(await ws.jobsFinished!(['done', 'running'])).toBe(false);
    expect(await ws.jobsFinished!(['hung'])).toBe(false);
  });
});

describe('reverting a task on real video versions', () => {
  const version = (n: number, conversations: string[], actors: string[]) =>
    ({ version: n, updatedAt: `2026-10-0${n}T00:00:00.000Z`, conversations: conversations.map((id) => ({ id, title: id })), actions: actors.map((actor) => ({ actor, label: 'edit', count: 1 })) }) as unknown;
  const task = {
    threadId: 'conv_thread',
    resources: [
      { kind: 'video', projectId: 'p1', videoId: 'v1' },
      { kind: 'video', projectId: 'p1', videoId: 'v2' },
    ],
  } as unknown as WorkItem;

  function setup(lists: Record<string, unknown[]>) {
    const opened: string[] = [];
    const restored: { videoId: string; version: number; before: boolean }[] = [];
    const ws = runtimeWorkspace({
      projects: () => [],
      videos: () => [],
      job: () => undefined,
      versions: async (videoId) => ({ versions: [...(lists[videoId] ?? [])].reverse(), unreadable: [] }) as unknown as VideoVersionList,
      openVideo: async (_projectId, videoId) => void opened.push(videoId),
      restoreVersion: async (videoId, n, before) => {
        restored.push({ videoId, version: n, before });
        return 99;
      },
    });
    return { ws, opened, restored };
  }

  it('the plan starts at the first version the thread made and lists the user edits after it', async () => {
    const { ws, opened } = setup({
      v1: [version(1, [], ['user_local']), version(2, ['conv_thread'], ['agent:x']), version(3, [], ['user_local']), version(4, ['conv_thread'], ['agent:x'])],
      v2: [version(1, ['conv_other'], ['agent:y'])],
    });
    const plan = await ws.revertPlan!(task);
    expect(opened).toEqual(['v1', 'v2']);
    expect(plan.videos).toEqual([
      { projectId: 'p1', videoId: 'v1', baseVersion: 2, userEdits: [{ version: 3, at: '2026-10-03T00:00:00.000Z', changes: [{ label: 'edit', count: 1 }] }], agentOnlyPossible: false, reason: expect.stringContaining('own edits') },
    ]);
  });

  it('reverting goes back to just before that version as the user; the thread only gets the versions to restore with its own tools', async () => {
    const clean = setup({ v1: [version(1, [], ['user_local']), version(2, ['conv_thread'], ['agent:x'])] });
    expect(await clean.ws.revert!(task, false)).toEqual([{ videoId: 'v1', version: 99 }]);
    expect(clean.restored).toEqual([{ videoId: 'v1', version: 2, before: true }]);
    expect(await clean.ws.revertThread!(task, 'before-thread')).toEqual([{ videoId: 'v1', version: 2, before: true }]);
    expect(await clean.ws.revertThread!(task, 1)).toEqual([{ videoId: 'v1', version: 1, before: false }]);
    expect(clean.restored).toHaveLength(1);

    const mixed = setup({ v1: [version(1, [], ['user_local']), version(2, ['conv_thread'], ['agent:x']), version(3, [], ['user_local'])] });
    await expect(mixed.ws.revertThread!(task, 'before-thread')).rejects.toThrow(/own edits/);
    expect(await mixed.ws.revert!(task, true)).toEqual([]);
    expect(await mixed.ws.revert!(task, false)).toEqual([{ videoId: 'v1', version: 99 }]);
  });

  it('another conversation changed the video after the thread: neither the thread nor the whole revert wipes those changes', async () => {
    const shared = setup({ v1: [version(1, [], ['user_local']), version(2, ['conv_thread'], ['agent:x']), version(3, ['conv_other'], ['agent:y'])] });
    const plan = await shared.ws.revertPlan!(task);
    expect(plan.videos).toEqual([expect.objectContaining({ videoId: 'v1', baseVersion: 2, agentOnlyPossible: false, reason: expect.stringContaining('another conversation') })]);
    await expect(shared.ws.revertThread!(task, 'before-thread')).rejects.toThrow(/another conversation/);
    expect(await shared.ws.revert!(task, false)).toEqual([]);
    expect(shared.restored).toEqual([]);
  });

  it('the thread\'s first versions were pruned: the task is not undone from a later version instead', async () => {
    // 线程从 1 号改起，视频只留下 3–5 号：任务开始后有版本被清掉，分不清起点。
    const started = { ...task, createdAt: '2026-10-01T00:00:00.000Z', baseVersions: [] } as WorkItem;
    const pruned = setup({ v1: [version(3, ['conv_thread'], ['agent:x']), version(4, ['conv_thread'], ['agent:x']), version(5, ['conv_thread'], ['agent:x'])] });
    const plan = await pruned.ws.revertPlan!(started);
    expect(plan.videos).toEqual([expect.objectContaining({ videoId: 'v1', agentOnlyPossible: false, reason: expect.stringContaining('no longer kept') })]);
    expect(await pruned.ws.revert!(started, false)).toEqual([]);
    await expect(pruned.ws.revertThread!(started, 'before-thread')).rejects.toThrow(/no longer kept/);
    expect(await pruned.ws.baselines!(started)).toEqual([]);
    expect(pruned.restored).toEqual([]);

    // 记下的基线（1 号）已经不在：同样不撤。
    const recorded = { ...started, baseVersions: [{ projectId: 'p1', videoId: 'v1', version: 1 }] } as WorkItem;
    expect((await pruned.ws.revertPlan!(recorded)).videos).toEqual([expect.objectContaining({ baseVersion: 1, reason: expect.stringContaining('version 1') })]);
    expect(await pruned.ws.revert!(recorded, false)).toEqual([]);
  });

  it('a recorded baseline that is still kept wins over the earliest version left, and pruning before the task does not block', async () => {
    const started = { ...task, createdAt: '2026-10-03T12:00:00.000Z', baseVersions: [{ projectId: 'p1', videoId: 'v1', version: 4 }] } as WorkItem;
    // 1–2 号被清掉，但都在任务开始之前；线程在 4 号改起，后面几版里只剩 6 号还标着它（5 号是用户的，已并进去也无妨）。
    const kept = setup({ v1: [version(3, [], ['user_local']), version(4, [], ['agent:x']), version(6, ['conv_thread'], ['agent:x'])] });
    expect((await kept.ws.revertPlan!(started)).videos).toEqual([expect.objectContaining({ videoId: 'v1', baseVersion: 4, agentOnlyPossible: true, reason: null })]);
    expect(await kept.ws.revert!(started, false)).toEqual([{ videoId: 'v1', version: 99 }]);
    expect(kept.restored).toEqual([{ videoId: 'v1', version: 4, before: true }]);

    // 没记下时，最早还在的一版在任务开始之前：从线程最早的那一版撤，并能把它记下来。
    const fresh = { ...started, baseVersions: [] } as WorkItem;
    expect(await kept.ws.baselines!(fresh)).toEqual([{ projectId: 'p1', videoId: 'v1', version: 6 }]);
  });

  it('is not offered without a way to open videos and restore versions', () => {
    expect(workspace(async () => list(1, 'r1', since)).revert).toBeUndefined();
  });
});
