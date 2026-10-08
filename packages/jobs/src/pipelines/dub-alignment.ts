/**
 * 配音的时间对齐（视频格式规范 §7.3 的 `fit-fixed-slot`；架构设计 §7.9）：一句配音放进原句在序列上的时间窗。
 * 纯函数，同样的输入总是同样的结果。秒都是序列时间。
 *
 * 规则，按顺序：
 * 1. 不比时间窗长：从原句的起点放，不变速；
 * 2. 比时间窗长：按需加速（ffmpeg `atempo`，保持音高），倍率向上取到千分位，至多 `maxTempo`（默认 1.25）；
 * 3. 加速到上限仍放不下：可以占用这句之后、下一句之前的静音；
 * 4. 仍放不下：`overlong`，不放进时间线，如实报告超出多少。绝不截断，也绝不压到下一句上。
 *
 * 下一句的起点（`limit`）早于这句的终点时（两句重叠），时间窗只算到下一句的起点。
 */

export const MAX_DUB_TEMPO = 1.25;
/** 比较时的容差（秒）：浮点误差不让刚好放得下的句子变成放不下。 */
const EPSILON = 1e-6;

export type DubFit = 'fit' | 'tempo' | 'extended' | 'overlong';

export interface DubSlot {
  /** 原句在序列上的起点与终点。 */
  start: number;
  end: number;
  /** 不能越过的位置：下一句的起点，没有下一句时是序列的终点（不早于这句的终点）。 */
  limit: number;
}

export interface DubAlignment {
  fit: DubFit;
  /** 放在哪里（总是原句的起点）。 */
  start: number;
  /** 变速倍率；1 表示不变速。 */
  tempo: number;
  /** 变速之后的时长。 */
  duration: number;
  end: number;
  /** `overlong` 时超出 `limit` 多少秒；其余为 0。 */
  overflow: number;
}

/** 一句配音（合成出来的真实时长 `duration` 秒）放进时间窗 `slot`。 */
export function alignDub(slot: DubSlot, duration: number, maxTempo: number = MAX_DUB_TEMPO): DubAlignment {
  if (!(duration > 0) || !Number.isFinite(duration)) throw new RangeError('The voice-over duration must be positive');
  if (!(maxTempo >= 1) || !Number.isFinite(maxTempo)) throw new RangeError('maxTempo must be at least 1');
  if (!(slot.end >= slot.start)) throw new RangeError('The slot end must not be before its start');
  const start = slot.start;
  const end = Math.min(slot.end, Math.max(slot.limit, start));
  const limit = Math.max(slot.limit, start);
  const window = end - start;
  const placed = (fit: DubFit, tempo: number): DubAlignment => {
    const length = tempo === 1 ? duration : duration / tempo;
    return { fit, start, tempo, duration: length, end: start + length, overflow: 0 };
  };

  if (duration <= window + EPSILON) return placed('fit', 1);
  if (window > 0) {
    const tempo = Math.min(maxTempo, ceilTo(duration / window, 3));
    if (duration / tempo <= window + EPSILON) return placed('tempo', tempo);
  }
  const fastest = duration / maxTempo;
  if (start + fastest <= limit + EPSILON) return placed('extended', maxTempo);
  return { fit: 'overlong', start, tempo: maxTempo, duration: fastest, end: start + fastest, overflow: start + fastest - limit };
}

function ceilTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  // 先去掉浮点噪声再向上取：1.2 / 1 不会变成 1.201。
  return Math.ceil(Math.round(value * scale * 1e6) / 1e6) / scale;
}

/** 把 `atempo` 倍率写成 ffmpeg 的滤镜参数（单个 atempo 接受 0.5–100，这里只会是 1–1.25）。 */
export function atempoFilter(tempo: number): string {
  return `atempo=${tempo.toFixed(3)}`;
}
