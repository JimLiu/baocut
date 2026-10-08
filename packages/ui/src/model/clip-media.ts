import { mediaTimeToSeconds, type TimeMap } from '@baocut/protocol';

/**
 * 时间线上视频片段里的胶片条与波形（同旧版网页时间线的 `ElementMedia` / `WaveCanvas`）：
 * 片段里的横坐标 → 序列时间 → 经实例的 `timeMap` 到素材的源时间，再去取那个时间的画面与声音峰值。
 */

/** 胶片条一格的宽（像素）。格子从片段左边开始排。 */
export const TILE_WIDTH = 64;

/**
 * 序列时间到源时间的换算。线性映射：`sourceIn + (t − contentStart) × rate`，`contentStart` 是实例内容开始的序列时间
 * （拖动时跟着片段走，裁切开头时不动）。定格：一直是 `sourceAt`。
 */
export type SourceClock = { kind: 'linear'; contentStart: number; sourceIn: number; rate: number } | { kind: 'hold'; sourceAt: number };

export function sourceClock(timeMap: TimeMap, contentStart: number): SourceClock {
  if (timeMap.kind === 'hold') return { kind: 'hold', sourceAt: mediaTimeToSeconds(timeMap.sourceAt) };
  return { kind: 'linear', contentStart, sourceIn: mediaTimeToSeconds(timeMap.sourceIn), rate: timeMap.rate.num / timeMap.rate.den };
}

/** 序列时间（秒）在素材里的源时间（秒）。 */
export function sourceSecondsAt(clock: SourceClock, seconds: number): number {
  return clock.kind === 'hold' ? clock.sourceAt : clock.sourceIn + (seconds - clock.contentStart) * clock.rate;
}

/** 片段里看得见的格子 `[first, end)`。`clipLeft`、`view` 都是轨道内容里的横坐标。 */
export function visibleTiles(
  clipLeft: number,
  clipWidth: number,
  view: { left: number; right: number },
  tileWidth = TILE_WIDTH,
): [number, number] {
  const count = Math.ceil(clipWidth / tileWidth);
  const first = Math.min(count, Math.max(0, Math.floor((view.left - clipLeft) / tileWidth)));
  const end = Math.min(count, Math.ceil((view.right - clipLeft) / tileWidth));
  return [first, Math.max(first, end)];
}

const GRID = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/**
 * 取帧时间的粒度：不超过一格覆盖的源时长的最大一档。相邻两格取到不同的帧；缩放之后落在同一档上的时间还能复用缓存。
 */
export function thumbnailGrid(tileSourceSeconds: number): number {
  let step = GRID[0]!;
  for (const value of GRID) if (value <= tileSourceSeconds) step = value;
  return tileSourceSeconds >= 1200 ? Math.floor(tileSourceSeconds / 600) * 600 : step;
}

export interface FilmstripTile {
  index: number;
  /** 相对片段左边。 */
  left: number;
  width: number;
  /** 取帧的源时间（秒），已经按粒度取整。 */
  at: number;
}

/** 胶片条要画的格子：只算看得见的。每格取它左边那一刻的画面。 */
export function filmstripTiles(options: {
  clipLeft: number;
  clipWidth: number;
  /** 片段左边的序列时间（秒）。 */
  clipStart: number;
  pxPerSecond: number;
  clock: SourceClock;
  /** 素材时长（秒）；不知道时不限制。 */
  sourceDuration: number | null;
  view: { left: number; right: number };
  tileWidth?: number;
}): FilmstripTile[] {
  const { clipLeft, clipWidth, clipStart, pxPerSecond, clock, sourceDuration, view } = options;
  const tileWidth = options.tileWidth ?? TILE_WIDTH;
  const [first, end] = visibleTiles(clipLeft, clipWidth, view, tileWidth);
  // 定格的每一格都是同一帧，不用取整。
  const grid = clock.kind === 'linear' ? thumbnailGrid((tileWidth / pxPerSecond) * clock.rate) : 0;
  const tiles: FilmstripTile[] = [];
  for (let index = first; index < end; index++) {
    const left = index * tileWidth;
    const source = sourceSecondsAt(clock, clipStart + left / pxPerSecond);
    let at = grid ? Math.round(source / grid) * grid : source;
    if (sourceDuration !== null) at = Math.min(at, sourceDuration);
    tiles.push({ index, left, width: Math.min(tileWidth, clipWidth - left), at: Math.max(0, Math.round(at * 1000) / 1000) });
  }
  return tiles;
}

/** `media.peaks` 的 base64 → 每格一个字节。 */
export function decodePeaks(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** 归一化时第 98 百分位至少按这么大算（约 −24 dBFS）：几乎静音的素材不会把底噪放大成满格。 */
const SCALE_FLOOR = 16;

/**
 * 显示用的放大倍数：按第 98 百分位归一化，个别爆音不会把整条包络压平（同旧版 BCW1）。
 * 峰值本身没有归一化，这样轻声的素材画出来不会太扁。
 */
export function peakScale(peaks: Uint8Array): number {
  if (peaks.length === 0) return 1;
  const counts = new Uint32Array(256);
  for (const level of peaks) counts[level]!++;
  const rank = Math.floor((peaks.length - 1) * 0.98);
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += counts[level]!;
    if (seen > rank) return 255 / Math.max(level, SCALE_FLOOR);
  }
  return 1;
}

/** 一段源时间 `[s0, s1)` 里最大的峰值（0–255）。 */
export function peakIn(peaks: Uint8Array, binsPerSecond: number, s0: number, s1: number): number {
  const from = Math.max(0, Math.floor(Math.min(s0, s1) * binsPerSecond));
  const to = Math.min(peaks.length, Math.max(from + 1, Math.ceil(Math.max(s0, s1) * binsPerSecond)));
  let max = 0;
  for (let i = from; i < to; i++) if (peaks[i]! > max) max = peaks[i]!;
  return max;
}

/**
 * 波形包络：画布从轨道内容的 `canvasLeft` 起、宽 `width`，每 `step` 像素一点，返回每点的幅度（0–1，已经乘了 `scale`）。
 * 定格没有声音，返回空。
 */
export function waveEnvelope(options: {
  canvasLeft: number;
  width: number;
  step: number;
  clipLeft: number;
  clipStart: number;
  pxPerSecond: number;
  clock: SourceClock;
  peaks: Uint8Array;
  binsPerSecond: number;
  scale: number;
}): number[] {
  const { canvasLeft, width, step, clipLeft, clipStart, pxPerSecond, clock, peaks, binsPerSecond, scale } = options;
  if (clock.kind === 'hold' || width <= 0) return [];
  const points: number[] = [];
  for (let k = 0, n = Math.ceil(width / step); k <= n; k++) {
    const x = canvasLeft + Math.min(width, k * step);
    const t0 = clipStart + (x - clipLeft) / pxPerSecond;
    const s0 = sourceSecondsAt(clock, t0);
    const s1 = sourceSecondsAt(clock, t0 + step / pxPerSecond);
    points.push(Math.min(1, (peakIn(peaks, binsPerSecond, s0, s1) / 255) * scale));
  }
  return points;
}
