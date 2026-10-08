import type { AssetRecord, EditOperation, Id, Rate, Sequence, SequenceItem } from '@baocut/protocol';
import { itemFrames } from './editor.ts';
import { joinWords, type SpeechWord } from './speech-cues.ts';
import {
  assetDuration,
  cutSeams,
  cutsWithin,
  decimalSeconds,
  restoreOperations,
  type CutSeam,
  type RestorePlan,
  type RestoreRefusal,
  type TrackedCut,
} from './transcript-cut.ts';

/**
 * 时间线上的剪口带（原型 timeline-cutbands.jsx；model-cut.js 的 `dragEdge` / `dragSlotEdge` / `retime`）。
 *
 * - 带从时间线推导（`cutSeams`）：视频与链接的音频在同一处各有一个接缝，并成一条贯穿各轨的带。恢复与改范围按素材的剪口集合
 *   （视频格式规范 §6.7）找盖住这处接缝的剪口；不是剪口剪掉的接缝照实拒绝。
 * - 时间线是成片：剪掉的内容不占时间。拖两缘用的坐标是「把这一处恢复之后」的序列帧，以剪口为 0：剪掉的那段在
 *   `[0, frames)`，左边的实例在它前面，右边的实例在它后面。
 * - 改范围 = 一笔事务：`restoreCut` 放回这一处的剪口，再 `addCuts` 剪新的素材区间，撤销一步回去；拖到零宽 = 只恢复。
 * - 缺省吸附词边界：左缘吸词的开头、右缘吸词的结尾，留 `WORD_PAD` 余量并对齐到帧，不越过相邻的词（不切半个词）；
 *   按住 Alt 自由落点，只对齐到帧。两缘夹在相邻实例之内：至少给邻居留一帧，邻居的另一头也是剪口时可以整段剪掉（两处剪口并成一处）。
 */

const EPS = 1e-6;

/** 吸附时词前后留的余量（素材秒，同内核 `bcut-timeline::words::DEFAULT_WORD_PAD`）。 */
export const WORD_PAD = 0.05;

export interface CutBand {
  key: string;
  assetId: Id;
  /** 代表剪口的左右实例（视频优先，其次轨道次序靠前的）：恢复从左实例往后拉，链接的实例跟着。 */
  leftId: Id;
  rightId: Id;
  /** 这一处在哪些轨道上有剪口（按轨道次序）。 */
  trackIds: Id[];
  /** 剪口在序列上的位置（帧，音频可以有小数）。 */
  frame: number;
  /** 剪掉的素材区间（秒，素材时钟）：左实例的出点到右实例的入点。 */
  from: number;
  to: number;
  /** 素材秒 / 序列秒。 */
  rate: number;
  /** 剪掉的长度（序列帧，取整与恢复插回的帧数一致）。 */
  frames: number;
  /** 左缘最早、右缘最晚能拖到哪（恢复之后的帧，相对剪口）。 */
  lo: number;
  hi: number;
}

function linearRate(item: SequenceItem): number {
  if ((item.type === 'video' || item.type === 'audio') && item.timeMap.kind === 'linear') {
    const rate = item.timeMap.rate.num / item.timeMap.rate.den;
    if (rate > 0) return rate;
  }
  return 1;
}

/** 时间线上的剪口带：同一素材、同一位置（取整到帧）的剪口并成一条，按位置排。 */
export function cutBands(sequence: Sequence): CutBand[] {
  const perSecond = sequence.fps.num / sequence.fps.den;
  const seams = cutSeams(sequence);
  const items = new Map(sequence.items.map((item) => [item.id, item]));
  const order = new Map(sequence.tracks.map((track) => [track.id, track.order]));
  // 开头 / 结尾本身也是剪口的实例：拖到头可以把它整段剪掉，两处剪口并成一处。
  const startsAtSeam = new Set(seams.map((seam) => seam.rightId));
  const endsAtSeam = new Set(seams.map((seam) => seam.leftId));
  const groups = new Map<string, CutSeam[]>();
  for (const seam of seams) {
    const key = `${seam.assetId}@${Math.round(seam.frame)}`;
    const list = groups.get(key);
    if (list) list.push(seam);
    else groups.set(key, [seam]);
  }
  const rank = (seam: CutSeam) => (items.get(seam.leftId)?.type === 'video' ? 0 : 1) * 1e6 + (order.get(seam.trackId) ?? 0);
  const bands: CutBand[] = [];
  for (const [key, list] of groups) {
    const rep = list.reduce((best, seam) => (rank(seam) < rank(best) ? seam : best));
    const left = items.get(rep.leftId);
    const right = items.get(rep.rightId);
    if (!left || !right) continue;
    const rate = linearRate(left);
    const frames = Math.round((rep.gap / rate) * perSecond);
    const leftLength = rep.frame - itemFrames(left, sequence.fps).start;
    const range = itemFrames(right, sequence.fps);
    const rightLength = range.end - range.start;
    const lo = -Math.floor(leftLength + EPS) + (startsAtSeam.has(left.id) ? 0 : 1);
    const hi = frames + Math.floor(rightLength + EPS) - (endsAtSeam.has(right.id) ? 0 : 1);
    bands.push({
      key,
      assetId: rep.assetId,
      leftId: rep.leftId,
      rightId: rep.rightId,
      trackIds: [...new Set(list.map((seam) => seam.trackId))].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
      frame: rep.frame,
      from: rep.to - rep.gap,
      to: rep.to,
      rate,
      frames,
      lo: Math.min(0, lo),
      hi: Math.max(frames, hi),
    });
  }
  return bands.sort((a, b) => a.frame - b.frame);
}

/** 被剪掉的文字：至少一半落在 `[from, to)`（素材秒）里的词，按先后拼起来；拼词规则同文稿。 */
export function cutText(words: readonly SpeechWord[], from: number, to: number): string {
  const inside = words
    .filter((word) => Math.min(word.end, to) - Math.max(word.start, from) >= (word.end - word.start) / 2 - EPS)
    .sort((a, b) => a.start - b.start);
  return joinWords(
    inside.map((word) => word.text),
    words.some((word) => /^\s/.test(word.text)),
  );
}

// ---- 拖两缘 ----

/** 词换到这一处的拖动坐标（恢复之后的帧，相对剪口），按开始时刻排。 */
export interface WordMark {
  t0: number;
  t1: number;
  word: SpeechWord;
}

/** 素材秒 → 这一处的拖动坐标：剪口左边按左实例、右边按右实例、剪掉的那段按比例摊进 `[0, frames]`。 */
function bandFrame(band: CutBand, seconds: number, perSecond: number): number {
  if (seconds <= band.from) return ((seconds - band.from) / band.rate) * perSecond;
  if (seconds >= band.to) return band.frames + ((seconds - band.to) / band.rate) * perSecond;
  return ((seconds - band.from) / (band.to - band.from)) * band.frames;
}

/** 这份转写里能吸附的词（只留两缘够得着的那一截，前后各多留一个当相邻词）。 */
export function bandWordMarks(band: CutBand, words: readonly SpeechWord[], fps: Rate): WordMark[] {
  const perSecond = fps.num / fps.den;
  const marks = words
    .map((word) => ({ t0: bandFrame(band, word.start, perSecond), t1: bandFrame(band, word.end, perSecond), word }))
    .sort((a, b) => a.t0 - b.t0);
  const first = marks.findIndex((mark) => mark.t1 >= band.lo);
  if (first < 0) return [];
  let last = marks.length - 1;
  while (last > first && marks[last]!.t0 > band.hi) last--;
  return marks.slice(Math.max(0, first - 1), Math.min(marks.length, last + 2));
}

/** 「从第 i 个词起剪」的起点：不越过前一个词的尾，留 `pad` 帧，先向外（向前）取整到帧，越回前一个词时改向内（内核 `word_span_start`）。 */
function spanStart(marks: readonly WordMark[], i: number, pad: number): number {
  const prevEnd = i > 0 ? marks[i - 1]!.t1 : -Infinity;
  const raw = Math.max(prevEnd, marks[i]!.t0 - pad);
  const out = Math.floor(raw + EPS);
  return out < prevEnd - EPS ? Math.ceil(raw - EPS) : out;
}

/** 「剪到第 i 个词为止」的终点（`spanStart` 的镜像，内核 `word_span_end`）。 */
function spanEnd(marks: readonly WordMark[], i: number, pad: number): number {
  const nextStart = i + 1 < marks.length ? marks[i + 1]!.t0 : Infinity;
  const raw = Math.min(nextStart, marks[i]!.t1 + pad);
  const out = Math.ceil(raw - EPS);
  return out > nextStart + EPS ? Math.floor(raw + EPS) : out;
}

/** 在 `[lo, hi]` 里找离 `target` 最近的词边界：二分定位后向两侧走到越界即停。 */
function snapEdge(
  marks: readonly WordMark[],
  edge: 'start' | 'end',
  target: number,
  lo: number,
  hi: number,
  pad: number,
): { at: number; word: SpeechWord } | null {
  const candidate = (i: number) => (edge === 'start' ? spanStart(marks, i, pad) : spanEnd(marks, i, pad));
  const key = (mark: WordMark) => (edge === 'start' ? mark.t0 : mark.t1);
  let a = 0;
  let b = marks.length;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (key(marks[mid]!) < target) a = mid + 1;
    else b = mid;
  }
  const found: { at: number; word: SpeechWord }[] = [];
  for (let i = a; i < marks.length; i++) {
    const at = candidate(i);
    if (at > hi + EPS) break;
    if (at >= lo - EPS) {
      found.push({ at, word: marks[i]!.word });
      if (at >= target) break;
    }
  }
  for (let i = a - 1; i >= 0; i--) {
    const at = candidate(i);
    if (at < lo - EPS) break;
    if (at <= hi + EPS) {
      found.push({ at, word: marks[i]!.word });
      if (at <= target) break;
    }
  }
  // 一样近时取先找到的（目标之后的那个），同原型。
  const best = found.reduce<{ at: number; word: SpeechWord } | null>(
    (pick, next) => (!pick || Math.abs(next.at - target) < Math.abs(pick.at - target) ? next : pick),
    null,
  );
  return best ? { at: Math.min(hi, Math.max(lo, best.at)), word: best.word } : null;
}

/** 拖动中的新区间（恢复之后的帧，相对剪口）。`start === end` 是拖到了零宽：松手就是恢复。 */
export interface BandDrag {
  edge: 'start' | 'end';
  start: number;
  end: number;
  /** 吸附到的词；自由落点、没有词、或贴在极限上时没有。 */
  word: SpeechWord | null;
  changed: boolean;
}

/**
 * 拖一处剪口的一条边：`delta` 是指针从按下处挪了多少帧（序列帧）。只动被拖的那条边；左缘夹在 `[lo, end]`、右缘夹在
 * `[start, hi]`，越界贴住极限。缺省吸词边界，`free`（按住 Alt）时自由落点；都对齐到帧。没挪动时原样（单击不让旧边被吸走）。
 */
export function dragBandEdge(band: CutBand, marks: readonly WordMark[], edge: 'start' | 'end', delta: number, free: boolean, fps: Rate): BandDrag {
  if (!Number.isFinite(delta) || delta === 0) return { edge, start: 0, end: band.frames, word: null, changed: false };
  const lo = edge === 'start' ? band.lo : 0;
  const hi = edge === 'start' ? band.frames : band.hi;
  const target = (edge === 'start' ? 0 : band.frames) + delta;
  let at: number;
  let word: SpeechWord | null = null;
  if (target <= lo) at = lo;
  else if (target >= hi) at = hi;
  else {
    const pad = (WORD_PAD / band.rate) * (fps.num / fps.den);
    const snapped = free ? null : snapEdge(marks, edge, target, lo, hi, pad);
    if (snapped) ({ at, word } = snapped);
    else at = Math.min(hi, Math.max(lo, Math.round(target)));
  }
  const start = edge === 'start' ? at : 0;
  const end = edge === 'start' ? band.frames : at;
  return { edge, start, end, word, changed: start !== 0 || end !== band.frames };
}

// ---- 一笔事务 ----

/** 带上的一点（恢复之后的帧，相对剪口）→ 素材秒：`bandFrame` 的逆。 */
function bandSource(band: CutBand, at: number, perSecond: number): number {
  if (at <= 0) return band.from + (at / perSecond) * band.rate;
  if (at >= band.frames) return band.to + ((at - band.frames) / perSecond) * band.rate;
  return band.from + (at / band.frames) * (band.to - band.from);
}

/** 接缝在素材里的容差：半帧（素材秒）。剪口按最近的帧落到实例上，接缝两侧与剪口的边差不超过它。 */
const seamTolerance = (band: CutBand, perSecond: number) => (band.rate / perSecond) * 0.5 + EPS;

/** 恢复这一处：放回盖住接缝的剪口（`restoreCut`）。没有剪口盖住时照实拒绝。 */
export function bandRestore(sequence: Sequence, band: CutBand, cuts: readonly TrackedCut[]): RestorePlan {
  const perSecond = sequence.fps.num / sequence.fps.den;
  return restoreOperations(sequence, band.assetId, cuts, [{ from: band.from, to: band.to }], seamTolerance(band, perSecond));
}

export type RetimePlan =
  | {
      ok: true;
      /** 前一半：恢复这一处。 */
      restore: Extract<RestorePlan, { ok: true }>;
      operations: EditOperation[];
      /** 新的剪切长度（帧）；0 表示只恢复。 */
      frames: number;
    }
  | { ok: false; reason: RestoreRefusal };

/**
 * 改一处剪口的范围 → 一笔事务：放回这一处的剪口（`restoreCut`），再 `addCuts` 剪 `[start, end)`（相对剪口的帧）换成的素材区间。
 * 这处接缝要正好是剪口剪掉的（剪口的并集在半帧之内对上接缝两侧），不然拖动的坐标对不上，照实拒绝（`partial`）。
 * 范围没变返回 null（不写）。
 */
export function retimeOperations(
  sequence: Sequence,
  assets: Record<Id, AssetRecord>,
  band: CutBand,
  cuts: readonly TrackedCut[],
  range: { start: number; end: number },
): RetimePlan | null {
  if (range.start === 0 && range.end === band.frames) return null;
  const perSecond = sequence.fps.num / sequence.fps.den;
  const restore = bandRestore(sequence, band, cuts);
  if (!restore.ok) return restore;
  const tolerance = seamTolerance(band, perSecond);
  const found = cutsWithin(cuts, [{ from: band.from, to: band.to }], tolerance);
  const covered =
    Math.min(...found.map((c) => c.from)) <= band.from + tolerance && Math.max(...found.map((c) => c.to)) >= band.to - tolerance;
  if (!covered) return { ok: false, reason: 'partial' };
  const start = Math.min(range.start, range.end);
  const end = range.end;
  if (end - start < 1) return { ok: true, restore, operations: restore.operations, frames: 0 };
  const duration = assetDuration(assets, band.assetId);
  const from = Math.max(0, bandSource(band, start, perSecond));
  const to = duration === undefined ? bandSource(band, end, perSecond) : Math.min(duration, bandSource(band, end, perSecond));
  return {
    ok: true,
    restore,
    frames: end - start,
    operations: [
      ...restore.operations,
      { type: 'addCuts', sequenceId: sequence.id, assetId: band.assetId, cuts: [{ from: decimalSeconds(from), to: decimalSeconds(to) }] },
    ],
  };
}
