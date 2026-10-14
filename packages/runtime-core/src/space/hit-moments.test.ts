import { describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import type { SpaceEntry, Track, VideoItem, VideoSnapshot } from '@baocut/protocol';
import type { MediaAnalysis } from '../media-analysis.ts';
import type { SpaceCatalog } from '../space-catalog.ts';
import type { ReadContentResult } from './content-extract.ts';
import { momentPlan } from './hit-moments.ts';
import { SpaceThumbnails } from './space-thumbnails.ts';

const track = (id: string, order: number, visible = true): Track => ({
  id,
  order,
  kind: 'visual',
  locked: false,
  visible,
  muted: false,
  solo: { enabled: false, group: 'visual' },
});

const ms = (seconds: number) => ({ ticks: String(Math.round(seconds * 1000)), timescale: 1000 });

/** 30fps：`fromFrame`、`durationFrames` 按秒给。 */
function item(id: string, trackId: string, assetId: string, from: number, length: number, sourceIn: number, speed = 1): VideoItem {
  return {
    id,
    trackId,
    paintOrder: 0,
    type: 'video',
    enabled: true,
    locked: false,
    followPolicy: { kind: 'sequence-fixed' },
    span: { fromFrame: from * 30, durationFrames: length * 30 },
    place: {},
    assetRef: { id: assetId, revision: '1' },
    timeMap: { kind: 'linear', sourceIn: ms(sourceIn), rate: { num: speed, den: 1 } },
    embeddedAudio: { enabled: true, volume: 1, fadeIn: ms(0), fadeOut: ms(0) },
  } as VideoItem;
}

const asset = (video: boolean, duration = 60) => ({
  id: 'x',
  currentRevision: '1',
  revisions: {
    '1': {
      revision: '1',
      contentHash: 'h',
      mediaType: 'video/mp4',
      duration: ms(duration),
      ...(video ? { video: { width: 1920, height: 1080 } } : {}),
    },
  },
});

function content(
  items: VideoItem[],
  tracks: Track[] = [track('trk_v1', 0), track('trk_v2', 1)],
): Pick<ReadContentResult, 'snapshot' | 'documents'> {
  const snapshot = {
    rootSequenceId: 'seq',
    sequences: { seq: { id: 'seq', fps: { num: 30, den: 1 }, tracks, items } },
    assets: { clip: asset(true), broll: asset(true, 20), voice: asset(false) },
  } as unknown as VideoSnapshot;
  return {
    snapshot,
    documents: [
      { documentId: 'doc_speech', kind: 'speech', sourceAssetId: 'clip' },
      { documentId: 'doc_tr', kind: 'translation', sourceDocumentId: 'doc_speech' },
      { documentId: 'doc_voice', kind: 'speech', sourceAssetId: 'voice' },
    ],
  };
}

describe('检索命中的那一刻', () => {
  it('时间线秒：那一秒看得见的片段，前后各 2 秒、不超出片段，换成源时间', () => {
    // 时间线 0–10s 播素材 30–40s，10–20s 播素材 100–110s。
    const c = content([item('a', 'trk_v1', 'clip', 0, 10, 30), item('b', 'trk_v1', 'clip', 10, 10, 100)]);
    expect(momentPlan(c, { clock: 'sequence', startSec: 5, endSec: 7 })).toEqual({
      asset: { id: 'clip', revision: '1' },
      at: 35,
      frame: { contentHash: 'h', mediaType: 'video/mp4', durationSec: 60 },
      clip: { assetId: 'clip', revision: '1', from: 33, to: 39, hitFrom: 35, hitTo: 37 },
    });
    // 靠近剪口：不跨进下一个片段，命中本身也截在片段里。
    expect(momentPlan(c, { clock: 'sequence', startSec: 9, endSec: 11 })?.clip).toEqual({
      assetId: 'clip',
      revision: '1',
      from: 37,
      to: 40,
      hitFrom: 39,
      hitTo: 40,
    });
    expect(momentPlan(c, { clock: 'sequence', startSec: 0.5, endSec: 1 })?.clip).toMatchObject({ from: 30, to: 33 });
    // 时间线上没有片段的地方。
    expect(momentPlan(c, { clock: 'sequence', startSec: 25, endSec: 26 })).toBeNull();
  });

  it('叠在上面的可见轨道优先；隐藏的轨道、停用的片段、没有画面的素材不算；变速按倍率换算', () => {
    const over = item('o', 'trk_v2', 'broll', 4, 4, 2, 2);
    expect(
      momentPlan(content([item('a', 'trk_v1', 'clip', 0, 10, 30), over]), { clock: 'sequence', startSec: 5, endSec: 6 })?.clip,
    ).toEqual({
      assetId: 'broll',
      revision: '1',
      from: 2,
      to: 10,
      hitFrom: 4,
      hitTo: 6,
    });
    const hidden = content([item('a', 'trk_v1', 'clip', 0, 10, 30), over], [track('trk_v1', 0), track('trk_v2', 1, false)]);
    expect(momentPlan(hidden, { clock: 'sequence', startSec: 5, endSec: 6 })?.asset.id).toBe('clip');
    const disabled = content([item('a', 'trk_v1', 'clip', 0, 10, 30), { ...over, enabled: false }]);
    expect(momentPlan(disabled, { clock: 'sequence', startSec: 5, endSec: 6 })?.asset.id).toBe('clip');
    expect(momentPlan(content([item('v', 'trk_v1', 'voice', 0, 10, 0)]), { clock: 'sequence', startSec: 1, endSec: 2 })).toBeNull();
  });

  it('定格的片段只有画面，没有可播的一段', () => {
    const still = { ...item('s', 'trk_v1', 'clip', 0, 5, 0), timeMap: { kind: 'hold', sourceAt: ms(12.5) } } as VideoItem;
    expect(momentPlan(content([still]), { clock: 'sequence', startSec: 1, endSec: 2 })).toMatchObject({ at: 12.5, clip: null });
  });

  it('源时间：文稿对应的素材（译文看它译自的文稿），不超出素材的时长；没有画面或找不到文稿时没有', () => {
    const c = content([]);
    expect(momentPlan(c, { clock: 'source', startSec: 1, endSec: 59, documentId: 'doc_speech' })?.clip).toEqual({
      assetId: 'clip',
      revision: '1',
      from: 0,
      to: 60,
      hitFrom: 1,
      hitTo: 59,
    });
    expect(momentPlan(c, { clock: 'source', startSec: 10, endSec: 12, documentId: 'doc_tr' })?.asset).toEqual({
      id: 'clip',
      revision: '1',
    });
    expect(momentPlan(c, { clock: 'source', startSec: 10, endSec: 12, documentId: 'doc_voice' })).toBeNull();
    expect(momentPlan(c, { clock: 'source', startSec: 10, endSec: 12, documentId: 'doc_none' })).toBeNull();
    expect(momentPlan(c, { clock: 'source', startSec: 10, endSec: 12 })).toBeNull();
  });
});

describe('那一刻用的视频内容', () => {
  it('内容索引说还是同一个版本时不再读；同时来的只读一次；版本变了、索引还在排队时重读', async () => {
    const index = { revision: '1', current: true };
    let reads = 0;
    const readContent = async (): Promise<ReadContentResult> => {
      reads++;
      const base = content([item('a', 'trk_v1', 'clip', 0, 10, 30)]);
      return { videoId: 'v', name: 'v', revision: index.revision, ...base } as ReadContentResult;
    };
    const catalog = {
      videoEntry: () => ({ dir: '/videos/v' }),
      index: { at: () => ({ revision: index.revision }), current: () => index.current },
    } as unknown as SpaceCatalog;
    const analysis = { assetFrame: async () => ({ mimeType: 'image/jpeg', data: 'AA==', at: 0 }) } as unknown as MediaAnalysis;
    const thumbnails = new SpaceThumbnails({
      catalog,
      analysis,
      assetFileAt: async () => ({ root: '/', file: 'x' }),
      readContent,
      log: silentLogger,
    });
    const entry = { id: 'ent_v', kind: 'video' } as SpaceEntry;
    const span = { clock: 'sequence' as const, startSec: 5, endSec: 6 };

    await Promise.all([thumbnails.moments(entry, [span]), thumbnails.moments(entry, [span])]);
    expect(reads).toBe(1);
    const again = await thumbnails.moments(entry, [span]);
    expect(reads).toBe(1);
    expect(again).toMatchObject({ revision: '1', moments: [{ frame: { kind: 'image' }, clip: { from: 33, to: 38 } }] });

    // 改过：索引在重读（不是当前的）时照样重读，版本跟着走。
    index.revision = '2';
    index.current = false;
    expect((await thumbnails.moments(entry, [span])).revision).toBe('2');
    expect(reads).toBe(2);
    await thumbnails.moments(entry, [span]);
    expect(reads).toBe(3);
    index.current = true;
    await thumbnails.moments(entry, [span]);
    await thumbnails.moments(entry, [span]);
    expect(reads).toBe(3);
  });
});
