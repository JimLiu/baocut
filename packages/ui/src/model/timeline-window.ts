/**
 * 时间线只画看得见的那一段（横向裁剪）：轨道少、时间长，一条轨上可以有上千件（剪口播剪出来的片段、一句一块的配音），
 * 全画出来打开与缩放都要卡几秒。这里只算：一条轨上哪些件与时间窗相交、刻度尺在时间窗里有哪几格。不碰 React 与 DOM。
 *
 * 时间窗用什么单位都行（帧或秒），只要与 `span` 给的一致。
 */

/** 一件在时间轴上的起止（`start ≤ end`）。 */
export interface Span {
  start: number;
  end: number;
}

/**
 * 按起点排好的一条轨：`starts` 升序；`reach[k]` 是排序后前 k+1 件里最晚的终点（单调不减），
 * 用它跳过窗口左边早已结束的那一大段，起点在窗口左外、却伸进窗口的长片段也不会漏。
 */
export interface SpanIndex<T> {
  /** 按起点排序（起点相同按原来的次序）。 */
  sorted: readonly T[];
  starts: Float64Array;
  ends: Float64Array;
  reach: Float64Array;
  /** 每件在原来列表里的次序：结果按它排回去（同一轨上重叠的件，DOM 次序决定谁压在上面）。 */
  order: ReadonlyMap<T, number>;
}

export function spanIndex<T>(items: readonly T[], span: (item: T) => Span): SpanIndex<T> {
  const entries = items.map((item, k) => ({ item, k, ...span(item) }));
  entries.sort((a, b) => a.start - b.start || a.k - b.k);
  const n = entries.length;
  const starts = new Float64Array(n);
  const ends = new Float64Array(n);
  const reach = new Float64Array(n);
  let far = -Infinity;
  entries.forEach((entry, i) => {
    starts[i] = entry.start;
    ends[i] = entry.end;
    far = Math.max(far, entry.end);
    reach[i] = far;
  });
  return { sorted: entries.map((e) => e.item), starts, ends, reach, order: new Map(entries.map((e) => [e.item, e.k])) };
}

/** 第一个满足 `pred` 的下标（`pred` 在数组上先假后真）；都不满足时是长度。 */
function firstWhere(values: Float64Array, pred: (value: number) => boolean): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pred(values[mid]!)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * 与时间窗 `[from, to]` 相交的件（贴边也算：`start ≤ to` 且 `end ≥ from`），再并上 `extra` 里在这条轨上的件
 * （正在拖的、菜单开着的……不管在不在窗里都要画），去重后按原来的次序返回。
 */
export function spansIn<T>(index: SpanIndex<T>, from: number, to: number, extra: Iterable<T> = []): T[] {
  const { sorted, starts, ends, reach, order } = index;
  const hi = firstWhere(starts, (start) => start > to);
  const lo = firstWhere(reach, (end) => end >= from);
  const picked = new Set<T>();
  for (let i = lo; i < hi; i++) if (ends[i]! >= from) picked.add(sorted[i]!);
  for (const item of extra) if (order.has(item)) picked.add(item);
  return [...picked].sort((a, b) => order.get(a)! - order.get(b)!);
}

export interface RulerTick {
  seconds: number;
  major: boolean;
}

/**
 * 刻度尺在 `[from, to]` 秒里的刻度（左边多带上 `from` 之前的那一格；不超过 `end` 秒、最多 `limit` 格）。第 i 格总在 `i × minor` 秒，与从 0 画起的整条尺
 * 一格不差（key 与标注都不变），滚动时只是两头增减。
 */
export function rulerTicks({
  minor,
  major,
  from,
  to,
  end,
  limit = 4000,
}: {
  minor: number;
  major: number;
  from: number;
  to: number;
  end: number;
  limit?: number;
}): RulerTick[] {
  const ticks: RulerTick[] = [];
  if (!(minor > 0)) return ticks;
  const last = Math.min(to, end);
  for (let i = Math.max(0, Math.floor(from / minor)); i * minor <= last && ticks.length < limit; i++) {
    const seconds = i * minor;
    ticks.push({ seconds, major: Math.abs(seconds / major - Math.round(seconds / major)) < 1e-6 });
  }
  return ticks;
}
