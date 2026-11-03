/**
 * 找「没声音、没动静」的段落（`assets_dead_air`）：按 Auto-Editor（Unlicense）的做法，不靠转写，所以没有人说话的素材（录屏、游戏、
 * 体育、Vlog 的空镜）也能用。这里只有不碰文件的计算：
 *
 * 1. 每个时间片（tick）判断有没有内容：声音是这一片的峰值除以整段的峰值，不低于 `threshold`；画面是这一片与上一帧变化的像素比例，
 *    不低于 `motionThreshold`。两种都要时任一有内容就算有。
 * 2. 短于 `minKeep` 的有内容段算噪声（一声咳嗽、一次闪烁），去掉；短于 `minCut` 的空档算正常的气口，留下。
 * 3. 有内容的段向两边各扩 `margin`，不把字头字尾切掉。
 * 4. 剩下的就是可以剪掉的区间。
 */

/** 一个时间片的秒数：与 30 fps 的一帧相同。 */
export const DEAD_AIR_TICK = 1 / 30;
export const DEFAULT_AUDIO_THRESHOLD = 0.04;
export const DEFAULT_MOTION_THRESHOLD = 0.02;
export const DEFAULT_MARGIN = 0.2;
export const DEFAULT_MIN_CUT = 0.5;
export const DEFAULT_MIN_KEEP = 0.1;
/** 两帧相差多少灰度算变了：缩小之后压缩噪声大约在 ±4 以内。 */
const MOTION_PIXEL_DELTA = 8;

export interface DeadAirOptions {
  margin: number;
  minCut: number;
  minKeep: number;
}

/** 区间：相对分析范围起点的秒。 */
export interface DeadRange {
  from: number;
  to: number;
}

/** 声音的每个时间片有没有内容。整段都是静音时全部没有内容。 */
export function audioActivity(pcm: Float32Array, sampleRate: number, threshold: number, tick: number = DEAD_AIR_TICK): Uint8Array {
  const samples = Math.max(1, Math.round(sampleRate * tick));
  const count = Math.ceil(pcm.length / samples);
  const peaks = new Float32Array(count);
  let top = 0;
  for (let i = 0; i < pcm.length; i++) {
    const value = Math.abs(pcm[i]!);
    const slot = Math.floor(i / samples);
    if (value > peaks[slot]!) peaks[slot] = value;
    if (value > top) top = value;
  }
  const active = new Uint8Array(count);
  if (top === 0) return active;
  for (let i = 0; i < count; i++) active[i] = peaks[i]! / top >= threshold ? 1 : 0;
  return active;
}

/** 相邻两帧（灰度，同样大小）变化的像素比例。 */
export function motionRatio(previous: Uint8Array, frame: Uint8Array): number {
  const length = Math.min(previous.length, frame.length);
  if (length === 0) return 0;
  let changed = 0;
  for (let i = 0; i < length; i++) {
    if (Math.abs(frame[i]! - previous[i]!) > MOTION_PIXEL_DELTA) changed += 1;
  }
  return changed / length;
}

/** 按固定帧率量出的画面变化比例换成时间片。 */
export function motionActivity(ratios: readonly number[], fps: number, threshold: number, ticks: number, tick: number = DEAD_AIR_TICK): Uint8Array {
  const active = new Uint8Array(ticks);
  for (let i = 0; i < ticks; i++) {
    const frame = Math.floor(i * tick * fps);
    active[i] = (ratios[Math.min(frame, ratios.length - 1)] ?? 0) >= threshold ? 1 : 0;
  }
  return active;
}

/** 两种判据合起来：任一有内容就算有；长度不同时按长的算。 */
export function combineActivity(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = a[i] || b[i] ? 1 : 0;
  return out;
}

/** 把短于 `shorter` 个时间片的 `value` 段改成另一个值。 */
function dropShortRuns(active: Uint8Array, value: 0 | 1, shorter: number): void {
  let start = 0;
  for (let i = 0; i <= active.length; i++) {
    if (i < active.length && active[i] === value) continue;
    if (i - start < shorter) active.fill(value === 1 ? 0 : 1, start, i);
    start = i + 1;
  }
}

/** 没有内容的区间（见模块说明）。 */
export function deadRanges(activity: Uint8Array, options: DeadAirOptions, tick: number = DEAD_AIR_TICK): DeadRange[] {
  const active = Uint8Array.from(activity);
  dropShortRuns(active, 1, Math.round(options.minKeep / tick));
  // 开头与结尾的空档没有「气口」一说：不论多短都留给剪口。
  const inner = firstAndLast(active);
  if (inner) {
    const middle = active.subarray(inner.first, inner.last + 1);
    dropShortRuns(middle, 0, Math.round(options.minCut / tick));
  }
  const margin = Math.round(options.margin / tick);
  const kept = new Uint8Array(active.length);
  for (let i = 0; i < active.length; i++) {
    if (active[i]) kept.fill(1, Math.max(0, i - margin), Math.min(active.length, i + margin + 1));
  }
  const ranges: DeadRange[] = [];
  let start = -1;
  for (let i = 0; i <= kept.length; i++) {
    if (i < kept.length && !kept[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      ranges.push({ from: start * tick, to: i * tick });
      start = -1;
    }
  }
  return ranges;
}

function firstAndLast(active: Uint8Array): { first: number; last: number } | null {
  const first = active.indexOf(1);
  return first < 0 ? null : { first, last: active.lastIndexOf(1) };
}
