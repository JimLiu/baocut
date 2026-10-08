import {
  framesToSeconds,
  itemAssetRef,
  itemRangeSeconds,
  itemTimeMap,
  mediaTimeToSeconds,
  type Id,
  type Rate,
  type Sequence,
} from '@baocut/protocol';

/**
 * `chapters_adopt` 的时间投影（架构设计 §7.9）：来源章节吸附后是素材（源）时间，章节固定在时间线的时刻上，
 * 要经过这个素材在时间线上的片段换成时间线秒。与取帧（`frameSourceAt`，时间线 → 源）方向相反。
 *
 * - 只认线性映射（`timeMap.kind` 为 `linear`）的启用片段；定格（`hold`）没有可逆的时间。
 * - 同一源时刻落在几个片段里（同一素材放了几次，或视频与音频各一个片段）取时间线上最早的那个。
 * - 源时刻落在剪掉的部分（不在任何片段里）时 `offTimeline: true`：落到源时间上之后最近的片段起点（话题在剪口之后接上）；
 *   之后没有片段时落到之前最近的那个片段的起点。
 */

/** 素材在时间线上的一段：源区间 `[sourceStart, sourceEnd)` 对应时间线从 `timelineStart` 起。 */
export interface AssetSegment {
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  /** 源秒每走 1 秒，时间线走 `rate.den / rate.num` 秒。 */
  rate: Rate;
}

/** 素材在序列上的线性片段，按时间线起点排序。没有放上时间线时为空。 */
export function assetSegments(sequence: Sequence, assetId: Id): AssetSegment[] {
  const segments: AssetSegment[] = [];
  for (const item of sequence.items) {
    if (!item.enabled || itemAssetRef(item)?.id !== assetId) continue;
    const map = itemTimeMap(item);
    if (map?.kind !== 'linear' || map.rate.num <= 0 || map.rate.den <= 0) continue;
    const range = itemRangeSeconds(item, sequence.fps);
    const length = range.end - range.start;
    if (!(length > 0)) continue;
    const sourceStart = mediaTimeToSeconds(map.sourceIn);
    segments.push({
      sourceStart,
      sourceEnd: sourceStart + (length * map.rate.num) / map.rate.den,
      timelineStart: range.start,
      rate: map.rate,
    });
  }
  return segments.sort((a, b) => a.timelineStart - b.timelineStart || a.sourceStart - b.sourceStart);
}

/** 一个源时刻在时间线上的位置；`segments` 不能为空。 */
export function projectSourceTime(segments: readonly AssetSegment[], sourceSeconds: number): { at: number; offTimeline: boolean } {
  let best: number | null = null;
  for (const segment of segments) {
    if (sourceSeconds < segment.sourceStart || sourceSeconds >= segment.sourceEnd) continue;
    const at = segment.timelineStart + ((sourceSeconds - segment.sourceStart) * segment.rate.den) / segment.rate.num;
    if (best === null || at < best) best = at;
  }
  if (best !== null) return { at: best, offTimeline: false };
  const after = segments
    .filter((segment) => segment.sourceStart > sourceSeconds)
    .sort((a, b) => a.sourceStart - b.sourceStart || a.timelineStart - b.timelineStart)[0];
  if (after) return { at: after.timelineStart, offTimeline: true };
  const before = [...segments].sort((a, b) => b.sourceEnd - a.sourceEnd || a.timelineStart - b.timelineStart)[0]!;
  return { at: before.timelineStart, offTimeline: true };
}

/** 一章投影前后：`sourceAt` 是吸附后的源时间，`at` 是时间线秒（对齐到帧）。 */
export interface ProjectedChapter<T> {
  title: string;
  sourceAt: number;
  at: number;
  offTimeline: boolean;
  row: T;
}

/**
 * 把清洗后的章节（源时间，按起点递增）投影到时间线并收拾成 `setChapters` 能收的样子：对齐到序列的帧、按时间线排序，
 * 首章钳到 0，与前一章落在同一帧或更早的丢掉（`dropped`，例如几章都落在剪口之后的同一个起点）。
 */
export function projectChapters<T>(
  rows: ReadonlyArray<{ title: string; start: number; row: T }>,
  segments: readonly AssetSegment[],
  fps: Rate,
): { kept: ProjectedChapter<T>[]; dropped: ProjectedChapter<T>[] } {
  const projected = rows
    .map((row) => {
      const { at, offTimeline } = projectSourceTime(segments, row.start);
      return { title: row.title, sourceAt: row.start, frame: Math.max(0, Math.round((at * fps.num) / fps.den)), offTimeline, row: row.row };
    })
    .sort((a, b) => a.frame - b.frame || a.sourceAt - b.sourceAt);
  const kept: ProjectedChapter<T>[] = [];
  const dropped: ProjectedChapter<T>[] = [];
  let last = -1;
  for (const [index, chapter] of projected.entries()) {
    const frame = index === 0 ? 0 : chapter.frame;
    const entry = {
      title: chapter.title,
      sourceAt: chapter.sourceAt,
      at: framesToSeconds(frame, fps),
      offTimeline: chapter.offTimeline,
      row: chapter.row,
    };
    if (frame <= last) {
      dropped.push(entry);
      continue;
    }
    kept.push(entry);
    last = frame;
  }
  return { kept, dropped };
}
