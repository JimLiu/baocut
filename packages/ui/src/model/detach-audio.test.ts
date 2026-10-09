import { describe, expect, it } from 'vitest';
import type { AssetRecord } from '@baocut/protocol';
import { sequence, track, videoItem } from '../testing/sequence-records.ts';
import { DETACH_TRACK_REF, canDetachAudio, detachAudioOperations } from './detach-audio.ts';

const asset = (audio: boolean): AssetRecord =>
  ({
    id: 'asset_v',
    kind: 'video',
    name: 'talk.mp4',
    currentRevision: '1',
    revisions: { '1': { revision: '1', ...(audio ? { audio: { sampleRate: 48000, channels: 2 } } : {}) } },
  }) as unknown as AssetRecord;

describe('分离音频', () => {
  it('素材有音轨、自带的声音开着、恒定速率时才能分', () => {
    const item = videoItem('v1', 't1', 30, 90);
    expect(canDetachAudio(item, asset(true))).toBe(true);
    expect(canDetachAudio(item, asset(false))).toBe(false);
    expect(canDetachAudio(item, undefined)).toBe(false);
    expect(canDetachAudio(videoItem('v1', 't1', 30, 90, { embeddedAudio: { enabled: false, volume: 1 } }), asset(true))).toBe(false);
    const hold = videoItem('v1', 't1', 30, 90, { timeMap: { kind: 'hold', sourceAt: { ticks: '0', timescale: 30 } } });
    expect(canDetachAudio(hold, asset(true))).toBe(false);
  });

  it('一笔里新建音频轨、放一段同素材同时间的音频、关掉视频自带的声音', () => {
    const timeMap = { kind: 'linear' as const, sourceIn: { ticks: '45', timescale: 30 }, rate: { num: 2, den: 1 } };
    const item = videoItem('v1', 't1', 30, 91, {
      name: '开场',
      role: 'broll',
      timeMap,
      embeddedAudio: { enabled: true, volume: 0.5, fadeIn: { ticks: '1', timescale: 2 }, envelope: [] },
    });
    const seq = sequence([track('t1', 'visual', 0)], [item], { fps: { num: 30000, den: 1001 } });
    expect(detachAudioOperations(seq, item)).toEqual([
      { type: 'addTrack', sequenceId: 'seq', kind: 'audio', ref: DETACH_TRACK_REF },
      {
        type: 'insertItems',
        sequenceId: 'seq',
        items: [
          {
            type: 'audio',
            trackRef: DETACH_TRACK_REF,
            assetRef: { id: 'asset_v', revision: '1' },
            fromFrame: 30,
            subframeOffset: { ticks: '0', timescale: 1 },
            playDuration: { ticks: String(91 * 1001), timescale: 30000 },
            timeMap,
            // 空包络省略；`enabled` 不是混音的字段。
            mix: { volume: 0.5, fadeIn: { ticks: '1', timescale: 2 } },
            name: '开场',
          },
        ],
      },
      { type: 'setAudioMix', sequenceId: 'seq', itemId: 'v1', muted: true },
    ]);
  });

  it('包络照抄', () => {
    const envelope = [{ percent: 0, volume: 1 }, { percent: 100, volume: 0.2 }];
    const item = videoItem('v1', 't1', 0, 30, { embeddedAudio: { enabled: true, volume: 1, envelope } });
    const insert = detachAudioOperations(sequence([track('t1', 'visual', 0)], [item]), item)[1] as { items: { mix: unknown }[] };
    expect(insert.items[0]!.mix).toEqual({ volume: 1, envelope });
  });
});
