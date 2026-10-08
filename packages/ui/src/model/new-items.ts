import {
  sequenceDurationFrames,
  type EditOperation,
  type FrameSpan,
  type Id,
  type Sequence,
  type SequenceItem,
  type Place,
  type SequenceItemInput,
} from '@baocut/protocol';
import { trackFree } from './editor-ops.ts';
import { round1 } from './geometry-panel.ts';

/**
 * 右侧面板「点一格 = 在播放头处新建」的共用部分（元素、文字两页）：落在哪段时间、哪几条轨道、画面上的哪个框，
 * 以及一笔事务的操作。照旧版的口径（bcut-editor-core `TimingDefault::at_playhead_in`、`default_place`）。
 */

/** 新建元素至少多长（秒，旧版 `MIN_ELEMENT_DURATION`）。 */
const MIN_SECONDS = 0.1;
/** 片子还是空的时候，跟到片尾的元素落多长（秒，旧版 `OPEN_ENDED_SPAN`）。 */
const OPEN_SECONDS = 10;

const perSecond = (sequence: Sequence) => sequence.fps.num / sequence.fps.den;
const minFrames = (sequence: Sequence) => Math.max(1, Math.round(MIN_SECONDS * perSecond(sequence)));

/**
 * 从 `startFrame` 起 `seconds` 秒。起点就是播放头，不往前挪：片子有长度时终点截到片尾，但至少留 0.1 秒；
 * 片子还是空的时候整段落下。
 */
export function spanAtPlayhead(sequence: Sequence, startFrame: number, seconds: number): FrameSpan {
  const start = Math.max(0, Math.round(startFrame));
  const least = minFrames(sequence);
  const wanted = Math.max(least, Math.round(seconds * perSecond(sequence)));
  const end = sequenceDurationFrames(sequence);
  return { fromFrame: start, durationFrames: end > 0 ? Math.max(least, Math.min(wanted, end - start)) : wanted };
}

/** 跟着整部片子的元素（进度条、声波）：从头到片尾；片子还是空的时候从播放头起 10 秒。 */
export function wholeFilmSpan(sequence: Sequence, startFrame: number): FrameSpan {
  const end = sequenceDurationFrames(sequence);
  return end > 0 ? { fromFrame: 0, durationFrames: end } : spanAtPlayhead(sequence, startFrame, OPEN_SECONDS);
}

/** 放进哪条轨道：已有的，或同一笔事务里 `addTrack` 新建的那条（`ref`）。 */
export type TrackSlot = { trackId: Id } | { trackRef: string };

/**
 * 给 `count` 层新画面找轨道（自下而上）：只用这段时间里有东西的最上面一条视觉轨之上的轨道——新建的东西要压在
 * 画面最上面才看得见。锁住或隐藏的跳过；不够的在最上面新建。
 */
export function visualSlots(
  sequence: Sequence,
  span: FrameSpan,
  count: number,
  name?: string,
): { slots: TrackSlot[]; operations: EditOperation[] } {
  const start = span.fromFrame;
  const end = start + span.durationFrames;
  const visual = sequence.tracks.filter((track) => track.kind === 'visual').sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const busy = visual.filter((track) => !trackFree(sequence, track.id, start, end));
  const floor = busy.length ? Math.max(...busy.map((track) => track.order)) : Number.NEGATIVE_INFINITY;
  const slots: TrackSlot[] = visual
    .filter((track) => track.order > floor && !track.locked && track.visible)
    .slice(0, count)
    .map((track) => ({ trackId: track.id }));
  const operations: EditOperation[] = [];
  for (let index = slots.length; index < count; index += 1) {
    const ref = `new-track-${index}`;
    operations.push({ type: 'addTrack', sequenceId: sequence.id, kind: 'visual', ref, ...(name ? { name } : {}) });
    slots.push({ trackRef: ref });
  }
  return { slots, operations };
}

/** 新建一层的位置：中心 `x` / `y` 是画幅宽高的百分比，`w` 是画幅宽的百分比，`rot` 是角度（度）。 */
export interface NewPlace {
  x: number;
  y: number;
  w?: number;
  rot?: number;
}

/** 新建一层的 `place`：取一位小数；中心总是写明（各种类的缺省中心不同），`w` 给了才写，不转时不写角度。 */
export function placeBox(place: NewPlace): Place {
  const out: Place = { x: round1(place.x), y: round1(place.y) };
  if (place.w !== undefined) out.w = round1(place.w);
  const rot = round1(place.rot ?? 0);
  if (rot !== 0) out.rot = rot;
  return out;
}

type Visual = Extract<SequenceItem, { type: 'text' | 'shape' | 'sticker' | 'visualizer' | 'progress' | 'confetti' | 'composition' }>;
type Fields<Item> = Item extends Visual
  ? Omit<Item, 'id' | 'lineage' | 'trackId' | 'span' | 'enabled' | 'locked' | 'paintOrder' | 'followPolicy'>
  : never;

/** 新建的一层画面：片段本身的字段，加上它比整组晚几帧出现（文字预设成员的错峰）。 */
export type VisualLayer = Fields<Visual> & { delayFrames?: number };

/**
 * 新建几层画面的一笔事务：缺的轨道先建，再一次插入。整组占 `span`，每层从 `span` 开头晚 `delayFrames` 出现、
 * 一直到整组结束（至少留 0.1 秒）；数组次序就是上下次序，低层在前。
 */
export function insertVisual(sequence: Sequence, span: FrameSpan, layers: readonly VisualLayer[], trackName?: string): EditOperation[] {
  const { slots, operations } = visualSlots(sequence, span, layers.length, trackName);
  const end = span.fromFrame + span.durationFrames;
  const latest = Math.max(span.fromFrame, end - minFrames(sequence));
  const items = layers.map(({ delayFrames = 0, ...fields }, index) => {
    const from = Math.min(latest, span.fromFrame + Math.max(0, Math.round(delayFrames)));
    return { ...fields, ...slots[index]!, span: { fromFrame: from, durationFrames: end - from } } as SequenceItemInput;
  });
  return [...operations, { type: 'insertItems', sequenceId: sequence.id, items }];
}

/** 回执里新建的片段（不含轨道与文档），按插入次序。 */
export function createdItemIds(createdIds: readonly Id[], sequence: Sequence): Id[] {
  const items = new Set(sequence.items.map((item) => item.id));
  return createdIds.filter((id) => items.has(id));
}
