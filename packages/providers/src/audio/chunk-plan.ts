/**
 * 切片计划（架构设计 §6.4）：超过单次请求上限的音频切成几块依次提交，边界尽量落在静音处。纯函数，单位是秒。
 *
 * 规则：从当前位置起，在 [位置 + 上限·50%, 位置 + 上限] 的窗口里找静音；与窗口相交的静音取它的中点（夹进窗口），
 * 取最靠后的一个作为切点；窗口里没有静音就在窗口末端硬切。窗口末端还要给剩下的部分至少留 `minChunkSec`，
 * 免得最后一块只有零点几秒。剩下的不超过上限时就是最后一块。
 */

export interface Silence {
  start: number;
  end: number;
}

export interface PlannedChunk {
  start: number;
  end: number;
}

export interface ChunkPlanInput {
  durationSec: number;
  /** 每块的上限（已经含余量）。 */
  maxChunkSec: number;
  silences: readonly Silence[];
  /** 最后一块至少多长；默认 min(1 秒, 上限的 1/4)。 */
  minChunkSec?: number;
}

/** 窗口从上限的这个比例开始。 */
const WINDOW_FROM = 0.5;

export function planChunks(input: ChunkPlanInput): PlannedChunk[] {
  const duration = Math.max(0, input.durationSec);
  const max = input.maxChunkSec;
  if (!(max > 0) || !Number.isFinite(max)) throw new Error('maxChunkSec must be a positive number');
  if (duration <= max) return [{ start: 0, end: duration }];
  const minTail = Math.min(input.minChunkSec ?? Math.min(1, max / 4), max / 2);
  const silences = input.silences
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const chunks: PlannedChunk[] = [];
  let cursor = 0;
  while (duration - cursor > max) {
    const windowEnd = Math.min(cursor + max, duration - minTail);
    const windowStart = Math.min(cursor + max * WINDOW_FROM, windowEnd);
    let cut = windowEnd;
    let found = -1;
    for (const silence of silences) {
      if (silence.end < windowStart || silence.start > windowEnd) continue;
      const point = clamp((silence.start + silence.end) / 2, windowStart, windowEnd);
      if (point > found) found = point;
    }
    if (found > cursor) cut = found;
    chunks.push({ start: cursor, end: cut });
    cursor = cut;
  }
  chunks.push({ start: cursor, end: duration });
  return chunks;
}

/**
 * 每块的时长上限：单次请求的时长上限与字节上限（按这种编码最坏情况下每秒的字节数折算）取小的，乘上余量；
 * 还可以给一个更短的偏好（例如不返回时间的模型切短一些，让插值的词时间不至于太粗）。
 */
export function chunkLimitSec(input: {
  maxDurationSec: number | null;
  maxInputBytes: number | null;
  bytesPerSec: number;
  /** 容器头部等固定开销。 */
  overheadBytes?: number;
  preferredSec?: number | null;
  margin?: number;
}): number {
  const margin = input.margin ?? 0.9;
  const limits: number[] = [];
  if (input.maxDurationSec !== null && input.maxDurationSec > 0) limits.push(input.maxDurationSec * margin);
  if (input.maxInputBytes !== null && input.maxInputBytes > 0) {
    limits.push(Math.max(1, (input.maxInputBytes - (input.overheadBytes ?? 0)) / input.bytesPerSec) * margin);
  }
  if (input.preferredSec) limits.push(input.preferredSec);
  return limits.length > 0 ? Math.min(...limits) : Number.POSITIVE_INFINITY;
}

/** 解析 ffmpeg `silencedetect` 写在 stderr 里的行。没有收尾的静音延续到 `durationSec`。 */
export function parseSilences(stderr: string, durationSec: number): Silence[] {
  const silences: Silence[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      open = Math.max(0, Number(start[1]));
      continue;
    }
    const end = /silence_end:\s*([\d.]+)/.exec(line);
    if (end && open !== null) {
      silences.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  if (open !== null && open < durationSec) silences.push({ start: open, end: durationSec });
  return silences.filter((s) => s.end > s.start);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
