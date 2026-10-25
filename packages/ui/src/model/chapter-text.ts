import type { Animation, ChapterTextProps, Marker, Sequence } from '@baocut/protocol';
import { placeBox, type VisualLayer } from './new-items.ts';
import { BLANK_TEXT } from './text-presets.ts';

/**
 * 章节文字（视频格式规范 §3.7 `TextItem.chapter`）在界面这一侧的纯模型：属性页的读数要说清此刻画什么、下一次什么时候换，
 * 判据必须和引擎画出来的一样，所以这里逐行照着 video-model `marker.rs` 的 `chapter_ranges` / `chapter_at` 与 timeline
 * `ChapterTextProps::text_of` 写，不用 `chapters.ts`：那一份给章节条用，按片长截断、不数长度为 0 的章，重叠时取先开始的。
 */

/** 序列的一章：第几章（从 0 起）、共几章、它的标记与帧区间。`endFrame` 为 null 时开到序列终点。 */
export interface ChapterRange {
  index: number;
  count: number;
  marker: Marker;
  fromFrame: number;
  endFrame: number | null;
}

/** 章节表：章节标记按帧排序（同帧保留存的次序），每章到自己的 `durationFrames`（大于 0 时）或下一章的帧为止，最后一章不封口。 */
export function chapterRanges(markers: readonly Marker[]): ChapterRange[] {
  const marks = markers.filter((m) => m.kind === 'chapter').sort((a, b) => a.frame - b.frame);
  return marks.map((marker, index) => {
    const next = marks[index + 1];
    const own = marker.durationFrames !== undefined && marker.durationFrames > 0 ? marker.frame + marker.durationFrames : null;
    return { index, count: marks.length, marker, fromFrame: marker.frame, endFrame: own ?? next?.frame ?? null };
  });
}

const covers = (range: ChapterRange, frame: number) => frame >= range.fromFrame && (range.endFrame === null || frame < range.endFrame);

/** 帧 `frame` 所在的那一章：几章重叠时取开始得晚的；不在任何一章里时为 null。 */
export function chapterRangeAt(ranges: readonly ChapterRange[], frame: number): ChapterRange | null {
  for (let i = ranges.length - 1; i >= 0; i--) if (covers(ranges[i]!, frame)) return ranges[i]!;
  return null;
}

/** 一章按绑定画出来的字；标题空白、没写摘要或摘要空白时为 null（这一章不画）。 */
export function chapterTextOf(range: ChapterRange, props: ChapterTextProps): string | null {
  const nonblank = (value: string | undefined) => (value !== undefined && value.trim() ? value : null);
  if (props.field === 'title') return nonblank(range.marker.label);
  if (props.field === 'summary') return nonblank(range.marker.summary);
  const n = range.index + 1;
  if (props.numberFormat === '01') return String(n).padStart(2, '0');
  if (props.numberFormat === '1/N') return `${n}/${range.count}`;
  return String(n);
}

/** 章节文字在帧 `frame` 上画的字；这一帧不画时为 null。 */
export function chapterTextAt(markers: readonly Marker[], frame: number, props: ChapterTextProps): string | null {
  const range = chapterRangeAt(chapterRanges(markers), frame);
  return range ? chapterTextOf(range, props) : null;
}

/**
 * 属性页读数要的这一刻：在哪一章、画什么，以及字下一次在哪一帧变：`next` 换成下一章（紧接着的，或重叠进来、开始得晚的那一章），
 * `gap` 这一章到头、之后是没有章的空档，`last` 一直画到片尾。
 */
export type ChapterReading =
  | { kind: 'noChapter' }
  | { kind: 'blank'; range: ChapterRange }
  | { kind: 'shown'; range: ChapterRange; text: string; changeFrame: number; then: 'next' | 'gap' | 'last' };

export function chapterReading(markers: readonly Marker[], frame: number, props: ChapterTextProps, totalFrames: number): ChapterReading {
  const ranges = chapterRanges(markers);
  const range = chapterRangeAt(ranges, frame);
  if (!range) return { kind: 'noChapter' };
  const text = chapterTextOf(range, props);
  if (text === null) return { kind: 'blank', range };
  const endFrame = Math.min(range.endFrame ?? totalFrames, totalFrames);
  // 按起点排过序，第一个落在 (frame, endFrame] 里的就是接手的那一章。
  const later = ranges.find((r) => r.fromFrame > frame && r.fromFrame <= endFrame);
  if (later) return { kind: 'shown', range, text, changeFrame: later.fromFrame, then: 'next' };
  return { kind: 'shown', range, text, changeFrame: endFrame, then: endFrame >= totalFrames ? 'last' : 'gap' };
}

/** 序列上有没有章节（「添加章节标题」要有章节才可用）。 */
export function hasChapters(sequence: Pick<Sequence, 'markers'>): boolean {
  return sequence.markers.some((m) => m.kind === 'chapter');
}

/** 逐字、逐词露出的入场与退场要一段写定的字，章节文字用不了（引擎同样拒绝，schema.rs）。 */
const FIXED_TEXT_PRESETS = new Set(['typewriter', 'riseWords']);

/**
 * 切到章节文字前要先去掉的动画：入场与退场里的打字机、逐词升起去掉，循环照旧；什么都不剩时为 null。
 * 不用改时返回 undefined（没有动画，或动画里没有这两种）。
 */
export function animationWithoutFixedText(animate: Animation | undefined): Animation | null | undefined {
  if (!animate) return undefined;
  const drop = (slot: Animation['enter']) => slot !== undefined && FIXED_TEXT_PRESETS.has(slot.preset);
  if (!drop(animate.enter) && !drop(animate.exit)) return undefined;
  const next: Animation = { ...animate };
  if (drop(next.enter)) delete next.enter;
  if (drop(next.exit)) delete next.exit;
  return next.enter || next.exit || next.loop ? next : null;
}

/** 「添加章节标题」的绑定：画此刻所在那一章的标题。 */
export const CHAPTER_TITLE_BIND: ChapterTextProps = { field: 'title' };

/**
 * 「添加章节标题」的那一层：从片头铺到片尾（跨度由调用方给），落在右上角那一格、副标题那一档的字（原型
 * model-elements.js `newChapterText`），样子与「添加文本框」相同，压在任何画面上都读得出。章名长短不一，钉住框顶，
 * 折成两行时往下长，不顶出画面。
 */
export function chapterTitleLayer(): VisualLayer {
  return {
    type: 'text',
    place: placeBox({ x: 78, y: 8, w: 36 }),
    chapter: { ...CHAPTER_TITLE_BIND },
    style: { ...BLANK_TEXT.style },
    verticalAlign: 'top',
  };
}
