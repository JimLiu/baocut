import { describe, expect, it } from 'vitest';
import type { JobRecord, UsageRecord, VideoVersionList, WorkItem } from '@baocut/protocol';
import { runtimeWorkspace } from './workspace.ts';

const since = '2026-10-01T00:00:00.000Z';
const item = {} as WorkItem;

function workspace(versions: () => Promise<VideoVersionList>) {
  return runtimeWorkspace({
    projects: () => [],
    videos: () => [{ entryId: 'e1', dir: '/p/v1', projectId: 'p1', videoId: 'v1', lastActivityAt: since }],
    job: () => undefined,
    versions,
  });
}

const list = (version: number, toRevision: string, updatedAt: string) =>
  ({ versions: [{ version, toRevision, updatedAt }], unreadable: [] }) as unknown as VideoVersionList;

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
    expect(spend).toEqual({ day: [{ amount: '1.75', currency: 'USD' }], month: [{ amount: '3.75', currency: 'USD' }] });
  });

  it('is not offered without a ledger', () => {
    expect(workspace(async () => list(1, 'r1', since)).channelSpend).toBeUndefined();
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
      { projectId: 'p1', videoId: 'v1', baseVersion: 2, userEdits: [{ version: 3, at: '2026-10-03T00:00:00.000Z' }], agentOnlyPossible: false, reason: expect.stringContaining('own edits') },
    ]);
  });

  it('reverting goes back to just before that version as the user; the thread only gets the versions to restore with its own tools', async () => {
    const clean = setup({ v1: [version(1, [], ['user_local']), version(2, ['conv_thread'], ['agent:x'])] });
    expect(await clean.ws.revert!(task, false)).toEqual([{ videoId: 'v1', version: 99 }]);
    expect(clean.restored).toEqual([{ videoId: 'v1', version: 2, before: true }]);
    expect(await clean.ws.revertThread!(task, 'before-thread')).toEqual([{ videoId: 'v1', version: 2, before: true }]);
    expect(await clean.ws.revertThread!(task, 1)).toEqual([{ videoId: 'v1', version: 1, before: false }]);
    expect(clean.restored).toHaveLength(1);

    const mixed = setup({ v1: [version(2, ['conv_thread'], ['agent:x']), version(3, [], ['user_local'])] });
    await expect(mixed.ws.revertThread!(task, 'before-thread')).rejects.toThrow(/own edits/);
    expect(await mixed.ws.revert!(task, true)).toEqual([]);
    expect(await mixed.ws.revert!(task, false)).toEqual([{ videoId: 'v1', version: 99 }]);
  });

  it('another conversation changed the video after the thread: neither the thread nor the whole revert wipes those changes', async () => {
    const shared = setup({ v1: [version(2, ['conv_thread'], ['agent:x']), version(3, ['conv_other'], ['agent:y'])] });
    const plan = await shared.ws.revertPlan!(task);
    expect(plan.videos).toEqual([expect.objectContaining({ videoId: 'v1', baseVersion: 2, agentOnlyPossible: false, reason: expect.stringContaining('another conversation') })]);
    await expect(shared.ws.revertThread!(task, 'before-thread')).rejects.toThrow(/another conversation/);
    expect(await shared.ws.revert!(task, false)).toEqual([]);
    expect(shared.restored).toEqual([]);
  });

  it('is not offered without a way to open videos and restore versions', () => {
    expect(workspace(async () => list(1, 'r1', since)).revert).toBeUndefined();
  });
});
