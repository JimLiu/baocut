import { describe, expect, it } from 'vitest';
import type { EditOperation } from '@baocut/protocol';
import type { VideoService } from '../videos/video-service.ts';
import { importRecording } from './recording-import.ts';
import { TIMESCALE, type RecordingPackage } from './recording-package.ts';

/**
 * 导入的事务次序（屏幕录制设计 §7「导入」）：先放好、修好每一段的每个实例，最后一笔才 `linkItems` 成组；自动缩放紧跟清单与取景
 * 那一笔。用一个只记事务的假视频服务，不起引擎。
 */

interface Sent {
  commandId: string;
  operations: EditOperation[];
}

function fakeVideos() {
  const sent: Sent[] = [];
  let revision = 1;
  let next = 1;
  const video = {
    rootSequenceId: 'seq_root',
    get revision() {
      return `rev_${revision}`;
    },
    assets: {} as Record<string, { currentRevision: string; revisions: Record<string, unknown> }>,
    sequences: { seq_root: { items: [] as Array<{ id: string; assetRef: { id: string } }> } },
  };
  const service = {
    mirror: () => ({ video }),
    applyAs: async (request: Sent) => {
      sent.push({ commandId: request.commandId, operations: request.operations });
      const refs: Record<string, string> = {};
      const createdIds: string[] = [];
      for (const op of request.operations as Array<Record<string, unknown>>) {
        const id = `id_${next++}`;
        if (op.type === 'importAsset') video.assets[id] = { currentRevision: 'r1', revisions: { r1: {} } };
        if (op.type === 'addItem') {
          video.sequences.seq_root.items.push({ id, assetRef: { id: (op.asset as { assetId: string }).assetId } });
          createdIds.push(id);
        }
        if (typeof op.ref === 'string') refs[op.ref] = id;
      }
      revision += 1;
      return { receipt: { refs, createdIds } };
    },
  };
  return { sent, videos: service as unknown as VideoService };
}

function twoSegments(cursor: RecordingPackage['cursor']): RecordingPackage {
  const s = TIMESCALE;
  const stream = (segmentId: string, role: 'screen' | 'microphone', t0: number, t1: number) => ({
    id: `${segmentId}-${role}`,
    role,
    segmentId,
    file: `/rec/${segmentId}-${role}.mp4`,
    start: t0,
    coverage: { t0, t1 },
    length: t1 - t0 + s / 30,
  });
  return {
    recorder: { name: 'baocut' },
    platform: 'test',
    startedAt: '2026-11-15T00:00:00Z',
    capture: { kind: 'display', width: 320, height: 180, scale: 1 },
    cursor,
    keyboard: null,
    duration: 4 * s,
    segments: [
      { id: 's1', t0: 0, t1: 2 * s },
      { id: 's2', t0: 2 * s, t1: 4 * s },
    ],
    streams: [stream('s1', 'screen', 0, 2 * s), stream('s1', 'microphone', 0, 2 * s), stream('s2', 'screen', 2 * s, 4 * s), stream('s2', 'microphone', 2 * s, 4 * s)],
    cursors: [],
    warnings: [],
  };
}

async function run(options: { autoZoom: boolean; cursor: RecordingPackage['cursor'] }) {
  const { sent, videos } = fakeVideos();
  const result = await importRecording(videos, {
    videoId: 'vid_1',
    recordingId: 'rec_1',
    pkg: twoSegments(options.cursor),
    at: 0,
    actor: { kind: 'user', id: 'user_local' },
    steps: {},
    persist: async () => {},
    autoZoom: options.autoZoom,
  });
  return { sent, result };
}

describe('importRecording 的事务次序', () => {
  it('每段先放实例再修尾，全部放完才 linkItems；自动缩放紧跟清单与取景', async () => {
    const { sent, result } = await run({ autoZoom: true, cursor: 'separate' });
    expect(sent.map((s) => s.commandId)).toEqual([
      'rec_1_assets',
      'rec_1_documents',
      'rec_1_auto-zoom',
      'rec_1_items-1',
      'rec_1_trim-1',
      'rec_1_items-2',
      'rec_1_trim-2',
      'rec_1_link',
    ]);
    const types = (s: Sent) => s.operations.map((op) => op.type);
    expect(sent[2]!.operations).toEqual([{ type: 'regenerateAutoZooms', documentId: result.screenViewDocumentId }]);
    // 成组只在最后一笔，而且之前的每一笔都没有 linkItems。
    expect(sent.slice(0, -1).flatMap(types)).not.toContain('linkItems');
    const link = sent.at(-1)!;
    expect(types(link)[0]).toBe('linkItems');
    // 成组的正是前面放下、修过的那些实例。
    expect(sent.filter((s) => s.commandId.includes('items-')).flatMap(types)).toEqual(['addItem', 'addItem', 'addItem', 'addItem']);
    const trimmed = sent.filter((s) => s.commandId.includes('trim-')).flatMap((s) => s.operations.map((op) => (op as { itemId: string }).itemId));
    const linked = (link.operations[0] as { itemIds: string[] }).itemIds;
    expect(new Set(trimmed)).toEqual(new Set(linked));
    expect(result.itemIds).toEqual(linked);
    expect(result).toMatchObject({ recordingId: 'rec_1', autoZoomPending: false });
  });

  it('不要自动缩放或不录鼠标时不调 regenerateAutoZooms', async () => {
    for (const options of [{ autoZoom: false, cursor: 'separate' as const }, { autoZoom: true, cursor: 'none' as const }]) {
      const { sent } = await run(options);
      expect(sent.map((s) => s.commandId)).not.toContain('rec_1_auto-zoom');
      expect(sent.flatMap((s) => s.operations.map((op) => op.type))).not.toContain('regenerateAutoZooms');
    }
  });
});
