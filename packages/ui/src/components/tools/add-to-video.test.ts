import { describe, expect, it } from 'vitest';
import { RpcError, type AssetRecord, type FileTarget, type Sequence } from '@baocut/protocol';
import { addToMovieOperations } from '../../model/tool-outputs.ts';
import { videoItem } from '../../testing/sequence-records.ts';
import type { BackgroundUndoDeps } from '../thread/change-undo.ts';
import { addFileToVideo } from './add-to-video.ts';

const target: FileTarget = { projectId: 'proj_1', path: '样片' };
const music = { name: 'music.wav', fileName: 'music.wav' };

const sequenceOf = (items: unknown[]) => ({ id: 'seq', fps: { num: 30, den: 1 }, tracks: [], items }) as unknown as Sequence;

const receiptOf = (createdIds: string[]) => ({ receipt: { transactionId: 'tx_add', createdIds, updatedIds: [], deletedIds: [] } });

function fakeDeps(options: { holds?: boolean; items?: unknown[]; apply?: () => unknown } = {}) {
  const calls: { method: string; params: unknown }[] = [];
  const request = (async (method: string, params: unknown) => {
    calls.push({ method, params });
    if (method === 'videos.open') {
      const video = { revision: 'rev_7', rootSequenceId: 'seq', assets: {}, sequences: { seq: sequenceOf(options.items ?? []) } };
      return { ref: { videoId: 'mov_1' }, snapshot: { video } };
    }
    if (method === 'edits.apply') return options.apply ? options.apply() : receiptOf(['asset_1']);
    if (method === 'videos.close') return { closed: true };
    throw new Error(`unexpected ${method}`);
  }) as unknown as BackgroundUndoDeps['request'];
  return { calls, deps: { request, editorHolds: () => options.holds ?? false } as BackgroundUndoDeps };
}

const plan = (sequence: Sequence, assets: Record<string, AssetRecord>) => addToMovieOperations(sequence, assets, music, '/save/music.wav', null);

describe('addFileToVideo', () => {
  it('打开 → 按刚打开的版本提交一笔 → 关掉', async () => {
    const { deps, calls } = fakeDeps({ items: [{ id: 'clip' }] });
    await expect(addFileToVideo(deps, target, plan)).resolves.toEqual({ videoId: 'mov_1', transactionId: 'tx_add', placed: false, bed: null, onTimeline: false, changed: true });
    expect(calls.map((c) => c.method)).toEqual(['videos.open', 'edits.apply', 'videos.close']);
    expect(calls[0]!.params).toEqual(target);
    expect(calls[1]!.params).toMatchObject({ videoId: 'mov_1', expectedRevision: 'rev_7' });
    expect(calls[2]!.params).toEqual({ videoId: 'mov_1' });
  });

  it('时间线还空着时同一笔放上去，并告诉调用方', async () => {
    const { deps, calls } = fakeDeps();
    await expect(addFileToVideo(deps, target, plan)).resolves.toMatchObject({ placed: true });
    const { operations } = calls[1]!.params as { operations: { type: string }[] };
    expect(operations.map((o) => o.type)).toEqual(['importAsset', 'addItem']);
  });

  it('生成的音乐同一笔铺上音乐轨，修改名写配乐，铺法交给调用方', async () => {
    const { deps, calls } = fakeDeps({ items: [videoItem('v1', 't1', 0, 300)] });
    const generated = { ...music, origin: { source: 'generated' as const, jobId: 'job_1', capability: 'generateMusic' }, media: { durationSec: 4 } };
    const added = await addFileToVideo(deps, target, (sequence, assets) => addToMovieOperations(sequence, assets, generated, '/save/music.wav', null));
    expect(added.placed).toBe(true);
    expect(added.bed?.layout.length).toBeGreaterThan(0);
    const params = calls[1]!.params as { operations: { type: string }[]; labelRef?: { key?: string } };
    expect(params.operations[0]!.type).toBe('importAsset');
    expect(params.operations.at(-1)!.type).toBe('insertItems');
    expect(JSON.stringify(params.labelRef)).toContain('addSoundtrack');
  });

  it('同样的文件已在视频里时这一笔是空的：告诉调用方，没有可撤销的', async () => {
    const { deps } = fakeDeps({ items: [{ id: 'clip' }], apply: () => receiptOf([]) });
    await expect(addFileToVideo(deps, target, plan)).resolves.toMatchObject({ placed: false, changed: false });
  });

  it('编辑器占着这部视频时不替它关', async () => {
    const { deps, calls } = fakeDeps({ holds: true });
    await addFileToVideo(deps, target, plan);
    expect(calls.map((c) => c.method)).toEqual(['videos.open', 'edits.apply']);
  });

  it('被拒时原样抛出，视频照样关掉', async () => {
    const refused = new RpcError('forbidden', 'outside the project');
    const { deps, calls } = fakeDeps({
      apply: () => {
        throw refused;
      },
    });
    await expect(addFileToVideo(deps, target, plan)).rejects.toBe(refused);
    expect(calls.map((c) => c.method)).toEqual(['videos.open', 'edits.apply', 'videos.close']);
  });
});
