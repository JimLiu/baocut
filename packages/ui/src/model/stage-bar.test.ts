import { describe, expect, it } from 'vitest';
import type { AssetRecord, Sequence, Track, VideoItem } from '@baocut/protocol';
import {
  CANVAS_SIDE_MAX,
  ORIGINAL_RATIO,
  customRatio,
  isPortrait,
  ratioText,
  safeBox,
  safeZones,
  sourceSize,
  stageRatioCanvas,
  stageRatioOf,
} from './stage-bar.ts';

const fps = { num: 30, den: 1 };

function track(id: string, kind: Track['kind']): Track {
  return { id, order: 0, kind, locked: false, visible: true, muted: false, solo: { enabled: false, group: kind === 'audio' ? 'audio' : 'picture' } } as Track;
}

function video(id: string, asset: string): VideoItem {
  return {
    id,
    trackId: 'v1',
    type: 'video',
    enabled: true,
    locked: false,
    paintOrder: 0,
    followPolicy: { kind: 'sequence-fixed' },
    span: { fromFrame: 0, durationFrames: 90 },
    place: {},
    mode: 'fullscreen',
    assetRef: { id: asset, revision: '1' },
    timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 30 }, rate: { num: 1, den: 1 } },
    fit: 'contain',
    embeddedAudio: { enabled: true, volume: 1 },
  };
}

function sequence(items: Sequence['items'], tracks: Track[] = [track('v1', 'visual')]): Sequence {
  return {
    id: 'seq',
    revision: '1',
    name: 'Main',
    fps,
    canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: '#000000' },
    durationPolicy: { kind: 'derived' },
    tracks,
    items,
    animationBindings: [],
    transitions: [],
    markers: [],
    ducking: [],
  };
}

function videoAsset(id: string, width: number, height: number): AssetRecord {
  return {
    id,
    kind: 'video',
    name: id,
    currentRevision: '1',
    revisions: {
      '1': {
        revision: '1',
        contentHash: 'h',
        byteLength: 1,
        mediaType: 'video/mp4',
        storage: { mode: 'managed' },
        video: {
          displayWidth: width,
          displayHeight: height,
          rotation: 0,
          pixelAspectRatio: { num: 1, den: 1 },
          frameRate: { kind: 'cfr', rate: fps },
          ptsOrigin: { ticks: '0', timescale: 30 },
          hasAlpha: false,
        },
        provenance: { origin: 'import' },
      },
    },
  };
}

const hd = { width: 1920, height: 1080 };

describe('画幅表', () => {
  it('认出表里的档，表里的优先于「原始」', () => {
    expect(stageRatioOf(hd, hd)).toBe('16:9');
    expect(stageRatioOf({ width: 2538, height: 1080 }, null)).toBe('2.35:1');
    expect(stageRatioOf({ width: 1080, height: 1350 }, { width: 1080, height: 1350 })).toBe(ORIGINAL_RATIO);
    expect(stageRatioOf({ width: 1080, height: 1350 }, hd)).toBeNull();
  });

  it('钮上的字：表里的照写，别的约分，约不小写成小数', () => {
    expect(ratioText(hd)).toBe('16:9');
    expect(ratioText({ width: 1080, height: 1350 })).toBe('4:5');
    expect(ratioText({ width: 2520, height: 1080 })).toBe('7:3');
    expect(ratioText({ width: 1778, height: 1000 })).toBe('16:9');
    expect(ratioText({ width: 1001, height: 1000 })).toBe('1:1');
    expect(ratioText({ width: 1234, height: 1000 })).toBe('1.23:1');
    expect(ratioText({ width: 1000, height: 1234 })).toBe('1:1.23');
  });

  it('换一档：短边不变，「原始」按主视频的比例，没有视频时不换', () => {
    expect(stageRatioCanvas(hd, '9:16', null)).toEqual({ width: 1080, height: 1920 });
    expect(stageRatioCanvas(hd, '2.35:1', null)).toEqual({ width: 2538, height: 1080 });
    expect(stageRatioCanvas(hd, ORIGINAL_RATIO, { width: 1080, height: 1350 })).toEqual({ width: 1080, height: 1350 });
    expect(stageRatioCanvas(hd, ORIGINAL_RATIO, null)).toBeNull();
    expect(stageRatioCanvas(hd, '5:4', null)).toBeNull();
  });

  it('「原始」取主媒体里第一段视频的显示尺寸', () => {
    const assets = { a: videoAsset('a', 1080, 1350) };
    expect(sourceSize(sequence([video('v', 'a')]), assets)).toEqual({ width: 1080, height: 1350 });
    expect(sourceSize(sequence([]), assets)).toBeNull();
    expect(sourceSize(sequence([video('v', 'missing')]), assets)).toBeNull();
  });

  it('自定义：要正数，长边不超过引擎上限', () => {
    expect(customRatio(hd, 21, 9)).toEqual({ ok: true, canvas: { width: 2520, height: 1080 } });
    expect(customRatio(hd, 0, 9)).toEqual({ ok: false, reason: 'invalid' });
    expect(customRatio(hd, Number.NaN, 9)).toEqual({ ok: false, reason: 'invalid' });
    expect(customRatio(hd, 100, 1)).toEqual({ ok: false, reason: 'tooLong' });
    const edge = customRatio(hd, CANVAS_SIDE_MAX, 1080);
    expect(edge.ok && edge.canvas.width).toBe(CANVAS_SIDE_MAX);
  });

  it('竖幅才是竖幅', () => {
    expect(isPortrait({ width: 1080, height: 1920 })).toBe(true);
    expect(isPortrait({ width: 1080, height: 1080 })).toBe(false);
  });
});

describe('平台安全区', () => {
  it('三块遮挡区不重叠，安全框夹在中间', () => {
    const [top, right, bottom] = safeZones();
    expect(top).toMatchObject({ key: 'top', y: 0, h: 8 });
    expect(right).toMatchObject({ key: 'right', x: 82, y: 8, h: 68 });
    expect(bottom).toMatchObject({ key: 'bottom', y: 76, h: 24 });
    expect(safeBox()).toEqual({ x: 6, y: 8, w: 76, h: 68 });
  });
});

