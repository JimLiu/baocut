import type { CaptionItem, EditOperation, Id, Sequence } from '@baocut/protocol';
import { removeChapterOperation, sequenceChapters } from './chapters.ts';
import { itemFrames } from './editor.ts';
import { dubStemOf } from './timeline-dub.ts';

/**
 * 时间线的「删掉一段并前移」（原型 model-ripple.js 的 `BC_RIPPLE`）。两个入口共用这一份：
 *
 * - 删除选中（Delete、走带的删除钮、检查器、右键菜单、画布工具条）：删完以后，删掉的那几段里**所有轨道都空了**的部分合拢，
 *   后面的内容前移、总长变短；还有别的轨占着（例如一段文字、一段自己放的音频）就留空隙。什么算占着见 `gapsAfterDelete`。
 * - 从所有轨道删除一段（右键菜单、⇧Delete）：选中片段盖住的时间从每一条轨上拿掉，跨在边上的裁掉落在段里的部分，后面的内容前移。
 *
 * 都编译成引擎的 `removeRange`（命令协议规范 §4.2，波纹删除），从右往左排，前面那段的帧不受后面那段影响。章节标记不归
 * `removeRange` 管（视频格式规范 §3.13），这里与「剪掉一章」（chapters.ts `cutChapterOperations`）一样另写 `upsertChapter`
 * 让后面的章跟着前移；落在拿掉的那段里的回到段首，整章都在段里的删掉。时间一律是整帧。
 */

/** 序列上的一段（帧，左闭右开）。 */
export interface FrameSpan {
  start: number;
  end: number;
}

/** 音频的起止可以有小数帧：量化时容这么多误差。 */
const EPS = 1e-6;

/** 一组区间的并集：按起点排好，相接或重叠的并成一段，空的去掉。 */
export function mergeSpans(spans: readonly FrameSpan[]): FrameSpan[] {
  const list = spans
    .filter((span) => span.end > span.start)
    .map((span) => ({ start: span.start, end: span.end }))
    .sort((a, b) => a.start - b.start);
  const out: FrameSpan[] = [];
  for (const span of list) {
    const last = out.at(-1);
    if (last && span.start <= last.end + EPS) last.end = Math.max(last.end, span.end);
    else out.push(span);
  }
  return out;
}

/** `spans` 里没被 `cover` 盖住的部分。 */
export function uncoveredSpans(spans: readonly FrameSpan[], cover: readonly FrameSpan[]): FrameSpan[] {
  const holes = mergeSpans(cover);
  const out: FrameSpan[] = [];
  for (const span of mergeSpans(spans)) {
    let at = span.start;
    for (const hole of holes) {
      if (hole.end <= at + EPS || hole.start >= span.end - EPS) continue;
      if (hole.start > at + EPS) out.push({ start: at, end: hole.start });
      at = Math.max(at, hole.end);
    }
    if (span.end > at + EPS) out.push({ start: at, end: span.end });
  }
  return out;
}

/** 一个时刻（帧，可以有小数）在拿掉 `spans` 之后落在哪：段后的前移，落在段里的回到段首。 */
export function shiftFrame(frame: number, spans: readonly FrameSpan[]): number {
  return mergeSpans(spans)
    .reverse()
    .reduce((at, span) => (at >= span.end ? at - (span.end - span.start) : at > span.start ? span.start : at), frame);
}

/** 取整后的 -0 写成 0。 */
const whole = (frame: number) => frame + 0;

/** 整帧化：往里收（开头取上整、结尾取下整），不到一帧的去掉。 */
function inward(spans: readonly FrameSpan[]): FrameSpan[] {
  return spans
    .map((span) => ({ start: whole(Math.ceil(span.start - EPS)), end: whole(Math.floor(span.end + EPS)) }))
    .filter((span) => span.end > span.start);
}

/** 整帧化：往外扩（开头取下整、结尾取上整），盖住片段的每一帧。 */
function outward(spans: readonly FrameSpan[]): FrameSpan[] {
  return mergeSpans(spans.map((span) => ({ start: whole(Math.floor(span.start + EPS)), end: whole(Math.ceil(span.end - EPS)) })));
}

/**
 * 删掉这几件之后要合拢的空隙（整帧）：删掉的那几段里，留下的片段在任何一条轨上都不再盖到的部分（原型 editor-keys.jsx 的 `cover`）。
 *
 * - 字幕实例只在它的句子还出得来的地方算占着（与原型按句算、句间停顿也算占着同一个意思）：有作用实例（`scopeItemIds`）时，
 *   句子只投在留下的作用实例下面（caption-cues.ts `placeCues`），作用实例删掉了那一截字幕也跟着没了；没有作用实例的按它自己的区间算。
 * - 配音分离出的背景声与人声分轨不算占着（原型的「背景声」「原声」行）：它们跟着画面走，合拢时与视频一起被拿掉那一段。配音块算占着。
 * - 终点跟着序列末尾的实例（`untilSequenceEnd`）不算占着——它本来就随总长伸缩。
 *
 * 首尾相接时音频小数帧留下的不到一帧的缝不算。
 */
export function gapsAfterDelete(sequence: Sequence, deletedIds: readonly Id[]): FrameSpan[] {
  const gone = new Set(deletedIds);
  const deleted: FrameSpan[] = [];
  const cover: FrameSpan[] = [];
  for (const item of sequence.items) {
    if (gone.has(item.id)) deleted.push(itemFrames(item, sequence.fps));
    else if (item.type === 'caption') cover.push(...captionCover(sequence, item, gone));
    else if (!item.untilSequenceEnd && !dubStemOf(item)) cover.push(itemFrames(item, sequence.fps));
  }
  return inward(uncoveredSpans(deleted, cover));
}

/** 删掉 `gone` 之后字幕实例还占着的时间：作用实例留下的区间（裁在字幕实例自己的区间里）；没有作用实例时是它自己的区间。 */
function captionCover(sequence: Sequence, item: CaptionItem, gone: ReadonlySet<Id>): FrameSpan[] {
  const own = itemFrames(item, sequence.fps);
  const scope = item.scopeItemIds ?? [];
  if (scope.length === 0) return item.untilSequenceEnd ? [] : [own];
  const byId = new Map(sequence.items.map((other) => [other.id, other]));
  return scope.flatMap((id) => {
    const scoped = byId.get(id);
    if (!scoped || gone.has(id)) return [];
    const range = itemFrames(scoped, sequence.fps);
    const span = { start: Math.max(range.start, own.start), end: Math.min(range.end, own.end) };
    return span.end > span.start ? [span] : [];
  });
}

/**
 * 「从所有轨道删除这一段」拿掉的段（整帧）：选中的片段盖住的时间，并成几段。字幕实例不算——一个字幕实例通常铺满整条字幕轨，
 * 拿它的区间等于把整部视频删掉；字幕的句子跟着视频走（`scopeItemIds`）。
 */
export function selectionSpans(sequence: Sequence, itemIds: readonly Id[]): FrameSpan[] {
  const ids = new Set(itemIds);
  return outward(
    sequence.items.filter((item) => ids.has(item.id) && item.type !== 'caption').map((item) => itemFrames(item, sequence.fps)),
  );
}

export interface RipplePlan {
  /** `removeRange`（从右往左），再是章节的删除与前移。没有要拿的段时为空。 */
  operations: EditOperation[];
  /** 真的拿掉的段（帧，按先后）。 */
  spans: FrameSpan[];
  /** 拿掉的总帧数。 */
  frames: number;
  /** 后面有锁住的轨道或片段、没有拿的段：引擎会整笔拒绝（`TARGET_LOCKED`），所以不提交，由调用方说明。 */
  locked: FrameSpan[];
}

/**
 * 把这几段从时间线上拿掉。每一段声明的轨道是「段首之后还有片段」的轨道（按轨道次序）——没列的轨道不动，空轨与段前就结束的轨
 * 不列，免得一条锁住的空轨拦下整笔。后面一件也没有的段（片尾的空）不用拿：总长由片段推出，自己就短了。
 * `removedIds` 是同一笔事务里先删掉的片段（删除合拢时），不再算在轨上。
 */
export function rippleOperations(sequence: Sequence, spans: readonly FrameSpan[], removedIds: readonly Id[] = []): RipplePlan {
  const gone = new Set(removedIds);
  const remaining = sequence.items.filter((item) => !gone.has(item.id));
  const tracks = new Map(sequence.tracks.map((track) => [track.id, track]));
  const applied: FrameSpan[] = [];
  const locked: FrameSpan[] = [];
  const ranges: EditOperation[] = [];
  for (const span of [...mergeSpans(spans)].reverse()) {
    const after = remaining.filter((item) => itemFrames(item, sequence.fps).end > span.start + EPS);
    if (!after.length) continue;
    const trackIds = [...new Set(after.map((item) => item.trackId))].sort(
      (a, b) => (tracks.get(a)?.order ?? 0) - (tracks.get(b)?.order ?? 0),
    );
    if (after.some((item) => item.locked) || trackIds.some((id) => tracks.get(id)?.locked)) {
      locked.unshift(span);
      continue;
    }
    applied.unshift(span);
    ranges.push({
      type: 'removeRange',
      sequenceId: sequence.id,
      from: { unit: 'frames', value: span.start },
      to: { unit: 'frames', value: span.end },
      trackIds,
      alignment: 'exact-frame',
    });
  }
  return {
    operations: ranges.length ? [...ranges, ...chapterOperations(sequence, applied)] : [],
    spans: applied,
    frames: applied.reduce((sum, span) => sum + span.end - span.start, 0),
    locked,
  };
}

/**
 * 章节跟着前移：每章的起点按 `shiftFrame` 换算。几章落到同一帧时（都在拿掉的那段里，或一章贴着段首、后一章在段里），
 * 只留起点最晚的那一章——它的内容还在，前面几章整章都拿掉了，删掉它们的标记（引擎不许两章同帧）。
 * 删除写在前面，前移按原来的起点升序写：每一步落到的帧都已经空出来（与 `cutChapterOperations` 同一个道理）。
 */
function chapterOperations(sequence: Sequence, spans: readonly FrameSpan[]): EditOperation[] {
  const chapters = sequenceChapters(sequence).map((chapter) => ({ chapter, to: Math.round(shiftFrame(chapter.startFrame, spans)) }));
  const removed: EditOperation[] = [];
  const moved: EditOperation[] = [];
  chapters.forEach(({ chapter, to }, index) => {
    if (chapters[index + 1]?.to === to) {
      removed.push(removeChapterOperation(sequence.id, chapter));
      return;
    }
    if (to === chapter.startFrame) return;
    moved.push({
      type: 'upsertChapter',
      sequenceId: sequence.id,
      chapterId: chapter.id,
      at: { unit: 'frames', value: to },
      alignment: 'exact-frame',
    });
  });
  return [...removed, ...moved];
}

