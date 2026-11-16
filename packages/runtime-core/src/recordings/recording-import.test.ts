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
    sequences: {
      seq_root: {
        fps: { num: 30, den: 1 },
        items: [] as Array<{ id: string; type: 'video'; assetRef: { id: string }; span: { fromFrame: number; durationFrames: number } }>,
      },
    },
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
          // Like the engine: the start goes to the nearest frame of the 30 fps sequence.
          const fromFrame = Math.round(Number((op.at as { value: string }).value) * 30);
          video.sequences.seq_root.items.push({ id, type: 'video', assetRef: { id: (op.asset as { assetId: string }).assetId }, span: { fromFrame, durationFrames: 1 } });
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

async function run(options: { autoZoom: boolean; cursor: RecordingPackage['cursor'] }, pkg = twoSegments(options.cursor)) {
  const { sent, videos } = fakeVideos();
  const result = await importRecording(videos, {
    videoId: 'vid_1',
    recordingId: 'rec_1',
    pkg,
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

  it('修尾向下取到帧，不越过素材的结尾（真实录制的长度不在帧上）', async () => {
    const pkg = twoSegments('separate');
    // A real screen file: 2.788333 s, the segment ends at 2.788022 s (nearest frame at 30 fps is 2.8 s, past the file).
    pkg.segments = [
      { id: 's1', t0: 0, t1: 2_788_022 },
      { id: 's2', t0: 2_788_022, t1: 4_788_022 },
    ];
    // s2 starts 15 ms into its segment (rounds down to the frame at 2.8 s → 2.8 s) and its file ends before the segment.
    pkg.streams = [
      { id: 's1-screen', role: 'screen', segmentId: 's1', file: '/rec/s1-screen.mp4', start: 0, coverage: { t0: 0, t1: 2_788_022 }, length: 2_788_333 },
      { id: 's2-screen', role: 'screen', segmentId: 's2', file: '/rec/s2-screen.mp4', start: 2_803_022, coverage: { t0: 2_803_022, t1: 4_788_022 }, length: 1_985_000 },
    ];
    const { sent } = await run({ autoZoom: false, cursor: 'separate' }, pkg);
    const trims = sent.filter((x) => x.commandId.includes('trim-')).flatMap((x) => x.operations) as Array<{ at: { value: string }; alignment: string }>;
    expect(trims.map((t) => t.alignment)).toEqual(['floor-frame', 'floor-frame']);
    expect(Number(trims[0]!.at.value)).toBeLessThanOrEqual(2.788022);
    // Placed at frame 84 (2.8 s): the end may not pass 2.8 + 1.985 even though the coverage says 4.788022.
    expect(Number(trims[1]!.at.value)).toBeLessThanOrEqual(2.8 + 1.985);
  });

  it('不要自动缩放或不录鼠标时不调 regenerateAutoZooms', async () => {
    for (const options of [{ autoZoom: false, cursor: 'separate' as const }, { autoZoom: true, cursor: 'none' as const }]) {
      const { sent } = await run(options);
      expect(sent.map((s) => s.commandId)).not.toContain('rec_1_auto-zoom');
      expect(sent.flatMap((s) => s.operations.map((op) => op.type))).not.toContain('regenerateAutoZooms');
    }
  });
});
