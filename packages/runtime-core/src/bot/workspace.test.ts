import { describe, expect, it } from 'vitest';
import type { VideoVersionList, WorkItem } from '@baocut/protocol';
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
