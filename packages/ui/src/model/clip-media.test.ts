import { describe, expect, it } from 'vitest';
import type { TimeMap } from '@baocut/protocol';
import {
  TILE_WIDTH,
  decodePeaks,
  filmstripTiles,
  peakIn,
  peakScale,
  sourceClock,
  sourceSecondsAt,
  thumbnailGrid,
  visibleTiles,
  waveEnvelope,
} from './clip-media.ts';

const linear = (sourceIn: number, num = 1, den = 1): TimeMap => ({
  kind: 'linear',
  sourceIn: { ticks: String(sourceIn * 1000), timescale: 1000 },
  rate: { num, den },
});

describe('片段里的源时间', () => {
  it('线性映射：sourceIn 加上相对内容开始的时间乘速度', () => {
    const clock = sourceClock(linear(10, 2), 4);
    expect(sourceSecondsAt(clock, 4)).toBe(10);
    expect(sourceSecondsAt(clock, 5.5)).toBe(13);
  });

  it('定格：一直是同一个源时间', () => {
    const clock = sourceClock({ kind: 'hold', sourceAt: { ticks: '7', timescale: 2 } }, 4);
    expect(sourceSecondsAt(clock, 0)).toBe(3.5);
    expect(sourceSecondsAt(clock, 100)).toBe(3.5);
  });
});

describe('胶片条', () => {
  it('只算看得见的格子', () => {
    expect(visibleTiles(100, 640, { left: 0, right: 2000 })).toEqual([0, 10]);
    expect(visibleTiles(100, 640, { left: 300, right: 500 })).toEqual([3, 7]);
    expect(visibleTiles(100, 640, { left: 2000, right: 3000 })).toEqual([10, 10]);
    expect(visibleTiles(100, 640, { left: -500, right: 50 })).toEqual([0, 0]);
  });

  it('取帧粒度不超过一格覆盖的源时长', () => {
    expect(thumbnailGrid(0.05)).toBe(0.1);
    expect(thumbnailGrid(0.64)).toBe(0.5);
    expect(thumbnailGrid(1.6)).toBe(1);
    expect(thumbnailGrid(16)).toBe(15);
    expect(thumbnailGrid(4000)).toBe(3600);
  });

  it('每格取它左边那一刻的画面：经 timeMap 换成源时间、按粒度取整、不超出素材', () => {
    // 每秒 32 像素：一格 2 秒；速度 2 倍，一格覆盖 4 秒源时间，粒度 2 秒。
    const tiles = filmstripTiles({
      clipLeft: 64,
      clipWidth: 160,
      clipStart: 2,
      pxPerSecond: 32,
      clock: sourceClock(linear(1, 2), 2),
      sourceDuration: 8.5,
      view: { left: 0, right: 1000 },
    });
    expect(tiles).toEqual([
      { index: 0, left: 0, width: TILE_WIDTH, at: 2 },
      { index: 1, left: 64, width: TILE_WIDTH, at: 6 },
      { index: 2, left: 128, width: 32, at: 8.5 },
    ]);
  });

  it('裁掉开头时内容不动：片段左边晚于内容开始，从后面的源时间取起', () => {
    const tiles = filmstripTiles({
      clipLeft: 64,
      clipWidth: 64,
      clipStart: 3,
      pxPerSecond: 64,
      clock: sourceClock(linear(0), 2),
      sourceDuration: null,
      view: { left: 0, right: 1000 },
    });
    expect(tiles[0]!.at).toBe(1);
  });
});

describe('波形', () => {
  it('base64 解成字节', () => {
    expect([...decodePeaks(btoa(String.fromCharCode(0, 128, 255)))]).toEqual([0, 128, 255]);
  });

  it('取一段源时间里的最大峰值；区间不到一格时取那一格', () => {
    const peaks = Uint8Array.from([10, 50, 20, 200, 0]);
    expect(peakIn(peaks, 10, 0, 0.3)).toBe(50);
    expect(peakIn(peaks, 10, 0.31, 0.32)).toBe(200);
    expect(peakIn(peaks, 10, 0.9, 1.2)).toBe(0);
  });

  it('按第 98 百分位放大，几乎静音的素材有下限', () => {
    const peaks = new Uint8Array(100).fill(64);
    peaks[99] = 255;
    expect(peakScale(peaks)).toBeCloseTo(255 / 64);
    expect(peakScale(new Uint8Array(100).fill(2))).toBeCloseTo(255 / 16);
    expect(peakScale(new Uint8Array(0))).toBe(1);
  });

  it('包络沿画布逐点取峰值；定格没有波形', () => {
    const peaks = Uint8Array.from([255, 0, 128, 0]);
    const common = { width: 4, step: 2, clipLeft: 0, clipStart: 0, pxPerSecond: 2, peaks, binsPerSecond: 1, scale: 1 };
    expect(waveEnvelope({ ...common, canvasLeft: 0, clock: sourceClock(linear(0), 0) })).toEqual([1, 0, 128 / 255]);
    expect(
      waveEnvelope({ ...common, canvasLeft: 0, clock: sourceClock({ kind: 'hold', sourceAt: { ticks: '0', timescale: 1 } }, 0) }),
    ).toEqual([]);
  });
});
