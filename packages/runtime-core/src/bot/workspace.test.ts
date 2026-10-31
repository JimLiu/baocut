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
