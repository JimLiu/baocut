import {
  type AudioItem,
  type CutSetBody,
  type DocumentRecord,
  type EditOperation,
  type Id,
  type Sequence,
  type SequenceItem,
  type VideoItem,
  type AssetRecord,
  itemRangeSeconds,
  mediaTimeToSeconds,
  TRANSCRIPT_PARAGRAPH,
} from '@baocut/protocol';
import { itemFrames } from './editor.ts';
import {
  CUE_PARAMS,
  joinWords,
  projectSpeech,
  projectableItems,
  sentenceEnd,
  splitUntimed,
  SPEECH_CAPTION_EXTENSION,
  type PlacedWord,
  type SpeechWord,
} from './speech-cues.ts';

/**
 * 文稿：口播转写按段落和词摆出来，加上文字驱动剪辑里手动的那部分（产品设计 §5.7、S03；验收 AT-08、AT-09）。
 *
 * - 文稿按转写文档里的次序（素材次序）列词，每个词一处；剪没剪从时间线推导（`projectSpeech` 投不到序列上的词就是剪掉了），
 *   不另存剪辑表。同一段素材在时间线上用了两次时，一个词有两处落点：定位跳到第一处，剪掉时两处都剪。
 * - 「剪辑音画」：选中的词换成素材时钟上的区间，编成一笔 `addCuts`（视频格式规范 §6.7）：引擎把剪口记进素材的剪口集合，
 *   在播放这个素材的实例所在的轨道上波纹删除，其余实例按各自的 `followPolicy` 移动（§3.16）。
 * - 「恢复」是新的一笔事务，不是撤销：找到盖住选中的词（或时间线上那处接缝）的剪口，编成 `restoreCut`，整个剪口放回。
 *   不是剪口剪掉的（拖片段边缘裁掉的、剪口集合出现之前剪的）照实拒绝。
 * - 「改原文」：按词 ID 改转写正文（写回语音文档，产生新版本），不动时间线；删除只把词标成 `hidden`，各处读取方都跳过隐藏的词。
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const EPS = 1e-6;

// ---- 文稿里的词 ----

/** 词在时间线上的状态：全在、只剩一部分（剪口落在词中间）、整个剪掉。 */
export type WordState = 'kept' | 'partial' | 'cut';

export interface TranscriptWord extends SpeechWord {
  /** 在文稿里的次序（素材次序）。 */
  index: number;
  /** 投到序列上的各处（秒，按先后）。 */
  placements: PlacedWord[];
  state: WordState;
  /** 和前一个词之间要不要空一格（拼词规则同 `joinWords`）。 */
  spaced: boolean;
}

/**
 * 词有多少落在某个实例里时算「全在」：剪口按帧取整，词边上差一点不算剪到。反过来，时间线上只剩不到 `1 - KEPT_SHARE`
 * 的（剪口取整后留下的一丝）算整个剪掉，那一丝也不再当作落点。
 */
const KEPT_SHARE = 0.9;

/**
 * 某个素材的转写词（素材时钟）配上它们在序列上的落点与状态。词按开始时刻排（稳定排序，转写里同时开始的保持原次序）。
 */
export function transcriptWords(sequence: Sequence, assetId: Id, source: readonly SpeechWord[]): TranscriptWord[] {
  const words = source
    .map((word, n) => ({ word, n }))
    .sort((a, b) => a.word.start - b.word.start || a.n - b.n)
    .map(({ word }) => word);
  const placed = projectSpeech(sequence, assetId, words);
  const rates = new Map<Id, number>();
  for (const item of sequence.items) {
    const map = linear(item);
    if (map) rates.set(item.id, map.rate);
  }
  const byWord = new Map<string, PlacedWord[]>();
  for (const place of placed) {
    const list = byWord.get(place.id);
    if (list) list.push(place);
    else byWord.set(place.id, [place]);
  }
  const leading = words.some((word) => /^\s/.test(word.text));
  return words.map((word, index) => {
    const found = byWord.get(word.id) ?? [];
    // 每个实例各自盖住这个词的多少（素材秒），取最多的那个。
    const covered = new Map<Id, number>();
    for (const place of found) {
      covered.set(
        place.scopeItemId,
        (covered.get(place.scopeItemId) ?? 0) + (place.end - place.start) * (rates.get(place.scopeItemId) ?? 1),
      );
    }
    const best = Math.max(0, ...covered.values());
    const length = word.end - word.start;
    const sliver = best <= length * (1 - KEPT_SHARE) + EPS;
    const placements = sliver ? [] : found;
    const state: WordState = sliver ? 'cut' : best >= length * KEPT_SHARE - EPS ? 'kept' : 'partial';
    const prev = words[index - 1];
    const spaced = prev
      ? joinWords([prev.text, word.text], leading).length > joinWords([prev.text], leading).length + joinWords([word.text], leading).length
      : false;
    return { ...word, index, placements, state, spaced };
  });
}

export interface TranscriptParagraph {
  /** 首词 ID。 */
  key: string;
  speaker?: string;
  words: TranscriptWord[];
}

/** 段落划分：标了段首、换了说话人、停顿两秒以上时断；句末处够长了（或停顿稍长且不太短）也断。文稿导出用同一套（`TRANSCRIPT_PARAGRAPH`）。 */
export const PARAGRAPH = TRANSCRIPT_PARAGRAPH;

/** 按段落分组（转写多半没有存句子，`sentences: null`，所以按说话人、停顿与句末标点分）。宽度按字符数估，不必精确。 */
export function transcriptParagraphs(words: readonly TranscriptWord[]): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = [];
  let current: TranscriptWord[] = [];
  let width = 0;
  const flush = () => {
    if (!current.length) return;
    const first = current[0]!;
    paragraphs.push({ key: first.id, ...(first.speaker !== undefined ? { speaker: first.speaker } : {}), words: current });
    current = [];
    width = 0;
  };
  for (const word of words) {
    const prev = current.at(-1);
    if (prev) {
      const gap = word.start - prev.end;
      const ended = sentenceEnd(prev.text.trim());
      if (
        word.paragraphStart ||
        (prev.speaker ?? null) !== (word.speaker ?? null) ||
        gap >= PARAGRAPH.pauseSec ||
        (ended && (width >= PARAGRAPH.maxWidth || (gap >= PARAGRAPH.sentencePauseSec && width >= PARAGRAPH.minWidth)))
      ) {
        flush();
      }
    }
    current.push(word);
    width += [...word.text.trim()].length + (word.spaced ? 1 : 0);
  }
  flush();
  return paragraphs;
}

/** 落点按序列时刻排好的索引，播放头找词用。 */
export interface PlacementIndex {
  starts: number[];
  ends: number[];
  words: number[];
}

export function placementIndex(words: readonly TranscriptWord[]): PlacementIndex {
  const all = words.flatMap((word) => word.placements.map((place) => ({ start: place.start, end: place.end, index: word.index })));
  all.sort((a, b) => a.start - b.start || a.index - b.index);
  return { starts: all.map((p) => p.start), ends: all.map((p) => p.end), words: all.map((p) => p.index) };
}

/** 播放头落在哪个词上（词的下标）；落在词与词之间的停顿里时没有。 */
export function wordAt(index: PlacementIndex, seconds: number): number | null {
  let lo = 0;
  let hi = index.starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index.starts[mid]! <= seconds + EPS) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return null;
  return seconds < index.ends[found]! - EPS ? index.words[found]! : null;
}

// ---- 播放跟随：已读的词 ----

/**
 * 词在序列上最早那处落点的结尾（秒）；剪掉的词（没有落点）没有。播放头走过它就算「已读」：序列时间上的先后，
 * 不是素材次序——同一段素材用了两次时，播完第一处就算读过。
 */
export function playedEnd(word: TranscriptWord): number | undefined {
  if (!word.placements.length) return undefined;
  let start = Infinity;
  let end = Infinity;
  for (const place of word.placements) {
    if (place.start < start) {
      start = place.start;
      end = place.end;
    }
  }
  return end;
}

/** 各词 `playedEnd` 从小到大排好，求已读游标用。 */
export function playedIndex(words: readonly TranscriptWord[]): number[] {
  return words
    .flatMap((word) => {
      const end = playedEnd(word);
      return end === undefined ? [] : [end];
    })
    .sort((a, b) => a - b);
}

/**
 * 已读游标：不晚于播放头的最大的 `playedEnd`（一个词也没读完时 `-Infinity`）。`playedEnd <= 游标` 的词都已读，
 * 与 `playedEnd <= 播放头` 等价；游标只在播放头跨过词尾时变，播放头在词里走、在停顿里走都不变——订阅它不会每帧重渲。
 * 容差同 `wordAt`：词尾差一丝也算播完，所以一处落点不会既是当前词又算读过。
 */
export function playedUntil(ends: readonly number[], seconds: number): number {
  let lo = 0;
  let hi = ends.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ends[mid]! <= seconds + EPS) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? -Infinity : ends[found]!;
}

/** 一段里各词 `playedEnd` 的最小与最大值；整段剪掉（没有落点）时 null。 */
export function paragraphPlayedSpan(words: readonly TranscriptWord[]): [number, number] | null {
  let first = Infinity;
  let last = -Infinity;
  for (const word of words) {
    const end = playedEnd(word);
    if (end === undefined) continue;
    first = Math.min(first, end);
    last = Math.max(last, end);
  }
  return first === Infinity ? null : [first, last];
}

/**
 * 一段的已读阈值（`span` 见 `paragraphPlayedSpan`）：整段读完时 `Infinity`、一个词也没读时 `-Infinity`（都是常量，段落卡
 * 不必跟着游标重渲），只有读到一半的段才拿游标本身。`playedEnd <= 阈值` 的词已读。整段剪掉的段永远是 `-Infinity`。
 */
export function paragraphPlayed(span: readonly [number, number] | null, until: number): number {
  if (!span || until < span[0]) return -Infinity;
  return until >= span[1] ? Infinity : until;
}

/**
 * 把一个元素滚到滚动容器垂直中间的 `scrollTop`：`elTop` / `elHeight` 是它在容器内容坐标里的位置与高度。
 * 夹在 `[0, scrollHeight - clientHeight]`；内容比视口矮时为 0。
 */
export function centerScrollTop(scrollHeight: number, clientHeight: number, elTop: number, elHeight: number): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  const want = elTop + elHeight / 2 - clientHeight / 2;
  return Math.max(0, Math.min(max, Math.round(want)));
}

// ---- 声明的轨道 ----

/**
 * 剪与恢复要声明的轨道（按轨道次序）：取用这个素材的实例所在的轨道、与它们链接（同一 `linkGroupId`）的实例所在的轨道、
 * 作用实例指向它们的字幕所在的字幕轨。别的轨道（背景音乐、补充画面等）不动。
 */
export function cutTrackIds(sequence: Sequence, assetId: Id): Id[] {
  const instances = projectableItems(sequence, assetId);
  const ids = new Set(instances.map((item) => item.id));
  const groups = new Set(instances.flatMap((item) => (item.linkGroupId ? [item.linkGroupId] : [])));
  const tracks = new Set<Id>();
  for (const item of sequence.items) {
    if (
      ids.has(item.id) ||
      (item.linkGroupId !== undefined && groups.has(item.linkGroupId)) ||
      (item.type === 'caption' && (item.scopeItemIds ?? []).some((id) => ids.has(id)))
    ) {
      tracks.add(item.trackId);
    }
  }
  return sequence.tracks
    .filter((track) => tracks.has(track.id))
    .sort((a, b) => a.order - b.order)
    .map((track) => track.id);
}

// ---- 剪掉 ----

/** 素材时钟上的一段（秒，左闭右开）。 */
export interface SourceRange {
  from: number;
  to: number;
}

export type CutPlan =
  | {
      ok: true;
      operations: EditOperation[];
      /** 剪掉的素材区间（秒），按先后。 */
      ranges: SourceRange[];
      /** 序列上会删掉多少帧（估算：落点量化到帧之后的总和）。 */
      frames: number;
      words: number;
    }
  /** `nothing`：选中的词都已经不在时间线上；`too-short`：每一段都不足一帧。 */
  | { ok: false; reason: 'nothing' | 'too-short' };

/** 秒写成 `addCuts` 的十进制秒：保留到微秒，去掉末尾的 0；不写成指数，负数按 0。 */
export function decimalSeconds(value: number): string {
  return Math.max(0, value)
    .toFixed(6)
    .replace(/\.?0+$/, '');
}

/** 素材当前版本的时长（秒）；不知道时没有。剪口不能超出它。 */
export function assetDuration(assets: Record<Id, AssetRecord>, assetId: Id): number | undefined {
  const asset = assets[assetId];
  const duration = asset?.revisions[asset.currentRevision]?.duration;
  return duration ? mediaTimeToSeconds(duration) : undefined;
}

/**
 * 选中的词 → 一笔 `addCuts`。选中的、还在时间线上的词连成一串（中间夹着没选中的已剪词不打断，夹着没选中的留着的词就断开），
 * 每串剪素材里第一个词的开头到最后一个词的结尾（词间的停顿一起剪掉）。落点量化到帧之后不足一帧的串不剪。
 * 同一段素材在时间线上用了几次时，引擎在每一处都剪。`selected` 是词的下标。
 */
export function cutOperations(
  sequence: Sequence,
  assets: Record<Id, AssetRecord>,
  assetId: Id,
  words: readonly TranscriptWord[],
  selected: ReadonlySet<number>,
): CutPlan {
  const perSecond = sequence.fps.num / sequence.fps.den;
  const runs: Array<{ range: SourceRange; places: Map<Id, { start: number; end: number }> }> = [];
  let run: (typeof runs)[number] | null = null;
  let count = 0;
  for (const word of words) {
    if (!selected.has(word.index)) {
      if (word.placements.length) run = null;
      continue;
    }
    if (!word.placements.length) continue;
    count++;
    if (!run) {
      run = { range: { from: word.start, to: word.end }, places: new Map() };
      runs.push(run);
    }
    run.range.from = Math.min(run.range.from, word.start);
    run.range.to = Math.max(run.range.to, word.end);
    for (const place of word.placements) {
      const span = run.places.get(place.scopeItemId);
      if (span) {
        span.start = Math.min(span.start, place.start);
        span.end = Math.max(span.end, place.end);
      } else run.places.set(place.scopeItemId, { start: place.start, end: place.end });
    }
  }
  if (!runs.length) return { ok: false, reason: 'nothing' };
  const duration = assetDuration(assets, assetId);
  const ranges: SourceRange[] = [];
  const removed: Array<{ from: number; to: number }> = [];
  for (const { range, places } of runs) {
    const quantized = [...places.values()]
      .map((span) => ({ from: Math.max(0, Math.round(span.start * perSecond - EPS)), to: Math.round(span.end * perSecond - EPS) }))
      .filter((r) => r.to - r.from >= 1);
    if (!quantized.length) continue;
    removed.push(...quantized);
    ranges.push({ from: Math.max(0, range.from), to: duration === undefined ? range.to : Math.min(range.to, duration) });
  }
  if (!ranges.length) return { ok: false, reason: 'too-short' };
  removed.sort((a, b) => a.from - b.from);
  let frames = 0;
  let reach = -Infinity;
  for (const r of removed) {
    const from = Math.max(r.from, reach);
    if (r.to > from) frames += r.to - from;
    reach = Math.max(reach, r.to);
  }
  const operation: EditOperation = {
    type: 'addCuts',
    sequenceId: sequence.id,
    assetId,
    cuts: ranges.map((r) => ({ from: decimalSeconds(r.from), to: decimalSeconds(r.to) })),
  };
  return { ok: true, operations: [operation], ranges, frames, words: count };
}

// ---- 恢复 ----

type MediaItem = VideoItem | AudioItem;

interface MediaSpan {
  item: MediaItem;
  /** 序列上的区间（帧，音频可以有小数）。 */
  start: number;
  end: number;
  /** 素材时钟（秒）。 */
  sourceIn: number;
  sourceOut: number;
  rate: number;
}

function linear(item: SequenceItem): { sourceIn: number; rate: number } | null {
  if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') return null;
  if (item.timeMap.kind !== 'linear') return null;
  const rate = item.timeMap.rate.num / item.timeMap.rate.den;
  return rate > 0 ? { sourceIn: mediaTimeToSeconds(item.timeMap.sourceIn), rate } : null;
}

/** 时间线上取用这个素材的视频与音频实例（线性映射）。 */
function mediaSpans(sequence: Sequence, assetId?: Id): MediaSpan[] {
  const out: MediaSpan[] = [];
  for (const item of sequence.items) {
    if (item.type !== 'video' && item.type !== 'audio') continue;
    if (assetId !== undefined && item.assetRef.id !== assetId) continue;
    const map = linear(item);
    if (!map) continue;
    const { start, end } = itemFrames(item, sequence.fps);
    const seconds = itemRangeSeconds(item, sequence.fps);
    out.push({
      item,
      start,
      end,
      sourceIn: map.sourceIn,
      sourceOut: map.sourceIn + (seconds.end - seconds.start) * map.rate,
      rate: map.rate,
    });
  }
  return out;
}

/** 剪口集合里的一个剪口（素材秒）。 */
export interface TrackedCut {
  id: Id;
  from: number;
  to: number;
  ref?: Id;
}

/** 素材的剪口集合文档（至多一份；同引擎，有几份时取 ID 最小的）。 */
export function cutSetRecord(documents: Record<Id, DocumentRecord>, assetId: Id): DocumentRecord | undefined {
  let found: DocumentRecord | undefined;
  for (const record of Object.values(documents)) {
    if (record.kind !== 'cut-set' || record.sourceAssetId !== assetId) continue;
    if (!found || record.id < found.id) found = record;
  }
  return found;
}

/** 剪口集合的正文 → 剪口（素材秒，按先后）。不是 `baocut.cut-set/1` 时返回 null。 */
export function readCutSet(body: unknown): TrackedCut[] | null {
  if (!isObject(body) || body.schema !== 'baocut.cut-set/1' || !Array.isArray(body.cuts)) return null;
  const { timescale, cuts } = body as unknown as CutSetBody;
  if (!(timescale > 0)) return null;
  return cuts
    .map((cut) => ({
      id: cut.id,
      from: Number(cut.t0) / timescale,
      to: Number(cut.t1) / timescale,
      ...(cut.ref !== undefined ? { ref: cut.ref } : {}),
    }))
    .filter((cut) => Number.isFinite(cut.from) && Number.isFinite(cut.to))
    .sort((a, b) => a.from - b.from);
}

/** 剪口集合之外剪掉的：`untracked`——没有剪口盖住要恢复的内容（拖片段边缘裁掉的、剪口集合出现之前剪的）。 */
export type RestoreRefusal = 'untracked' | 'partial';

export type RestorePlan =
  | {
      ok: true;
      operations: EditOperation[];
      /** 放回的剪口。 */
      cutIds: Id[];
      /** 放回多少秒（序列时间，按素材的速度换算）。 */
      seconds: number;
    }
  | { ok: false; reason: RestoreRefusal };

/** 素材在时间线上的速度（素材秒 / 序列秒）：取第一个取用它的实例，没有时按 1。 */
export function assetRate(sequence: Sequence, assetId: Id): number {
  return mediaSpans(sequence, assetId)[0]?.rate ?? 1;
}

/** 和这些素材区间相交（容差 `tolerance` 秒）的剪口。 */
export function cutsWithin(cuts: readonly TrackedCut[], ranges: readonly SourceRange[], tolerance = EPS): TrackedCut[] {
  return cuts.filter((cut) => ranges.some((range) => cut.from < range.to - tolerance && cut.to > range.from + tolerance));
}

/**
 * 恢复盖住这些素材区间的剪口 → 一笔事务里的 `restoreCut`（每个剪口一个，整个放回）。没有剪口盖住时照实拒绝（`untracked`）。
 */
export function restoreOperations(
  sequence: Sequence,
  assetId: Id,
  cuts: readonly TrackedCut[],
  ranges: readonly SourceRange[],
  tolerance = EPS,
): RestorePlan {
  const found = cutsWithin(cuts, ranges, tolerance);
  if (!found.length) return { ok: false, reason: 'untracked' };
  const rate = assetRate(sequence, assetId);
  return {
    ok: true,
    operations: found.map((cut) => ({ type: 'restoreCut', sequenceId: sequence.id, assetId, cutId: cut.id })),
    cutIds: found.map((cut) => cut.id),
    seconds: found.reduce((sum, cut) => sum + (cut.to - cut.from) / rate, 0),
  };
}

/** 文稿里选中的、不全在时间线上的词 → 要恢复的素材区间（每个词一段）。 */
export function restoreRanges(words: readonly TranscriptWord[], selected: ReadonlySet<number>): SourceRange[] {
  return words.filter((w) => selected.has(w.index) && w.state !== 'kept').map((w) => ({ from: w.start, to: w.end }));
}

// ---- 时间线上的剪口 ----

/** 同一轨道上首尾相接、取用同一素材、素材里中间空了一段的两个实例之间：剪过的地方。 */
export interface CutSeam {
  key: string;
  trackId: Id;
  assetId: Id;
  leftId: Id;
  rightId: Id;
  /** 剪口在序列上的位置（帧，音频可以有小数）。 */
  frame: number;
  /** 剪掉了多少素材（秒，素材时钟）。 */
  gap: number;
  /** 恢复时要露到的素材时刻（右实例的入点）。 */
  to: number;
}

/** 时间线上的剪口：同一轨道上首尾相接（差不到百万分之一帧）、同一种类、同一素材、速度一样、素材空了至少一帧的相邻两个实例。 */
export function cutSeams(sequence: Sequence): CutSeam[] {
  const perSecond = sequence.fps.num / sequence.fps.den;
  const byTrack = new Map<Id, MediaSpan[]>();
  for (const span of mediaSpans(sequence)) {
    const list = byTrack.get(span.item.trackId);
    if (list) list.push(span);
    else byTrack.set(span.item.trackId, [span]);
  }
  const seams: CutSeam[] = [];
  for (const [trackId, spans] of byTrack) {
    spans.sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) {
      const left = spans[i - 1]!;
      const right = spans[i]!;
      if (left.item.type !== right.item.type || left.item.assetRef.id !== right.item.assetRef.id) continue;
      if (Math.abs(right.start - left.end) > EPS || Math.abs(right.rate - left.rate) > EPS) continue;
      const gap = right.sourceIn - left.sourceOut;
      if (Math.round((gap / left.rate) * perSecond) < 1) continue;
      seams.push({
        key: `${left.item.id}|${right.item.id}`,
        trackId,
        assetId: left.item.assetRef.id,
        leftId: left.item.id,
        rightId: right.item.id,
        frame: left.end,
        gap,
        to: right.sourceIn,
      });
    }
  }
  return seams;
}

// ---- 改原文 ----

/** 拆开的未计时段的一块（`w-000007~3`）→ 转写里原本那个词的 ID。 */
export function rawWordId(id: string): string {
  return id.replace(/~\d+$/, '');
}

const pieceNumber = (id: string): number => Number(/~(\d+)$/.exec(id)?.[1] ?? '1');

/** 和 `readSpeechWords` 一样判断：没有词时间的整段、或文字中间有空白的词，读的时候会拆成几块。 */
function untimed(word: Json): boolean {
  const value = typeof word.text === 'string' ? word.text : '';
  return word.timingQuality === 'missing' || /\S\s+\S/.test(value.trim());
}

/** 未计时段拆出来的各块在原文里的位置（左闭右开的字符下标）。拆不开时只有一块，盖住整段（去掉首尾空白）。 */
function pieceSpans(value: string): Array<[number, number]> {
  const pieces = splitUntimed(value, 0, 1, CUE_PARAMS.maxChars);
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const piece of pieces) {
    const needle = piece.text.trim();
    const at = value.indexOf(needle, cursor);
    if (at < 0) return [[value.length - value.trimStart().length, value.trimEnd().length]];
    spans.push([at, at + needle.length]);
    cursor = at + needle.length;
  }
  return spans;
}

/** 把 `value` 里的 `[from, to)` 换成 `text`；换成空时连带吃掉一侧的空白，免得留下两个空格。 */
function splice(value: string, [from, to]: [number, number], text: string): string {
  if (text) return value.slice(0, from) + text + value.slice(to);
  let a = from;
  let b = to;
  if (a > 0 && /\s/.test(value[a - 1]!)) a--;
  else if (b < value.length && /\s/.test(value[b]!)) b++;
  return value.slice(0, a) + value.slice(b);
}

function speechWords(body: unknown): { body: Json; words: Json[]; index: Map<string, number> } | null {
  if (!isObject(body) || body.schema !== 'baocut.speech/1' || !Array.isArray(body.words)) return null;
  const words = body.words.map((word) => (isObject(word) ? { ...word } : word)) as Json[];
  const index = new Map<string, number>();
  words.forEach((word, i) => {
    if (isObject(word) && typeof word.id === 'string') index.set(word.id, i);
  });
  return { body, words, index };
}

/**
 * 改一个词的文字（`id` 是文稿里的词 ID，可以是拆开的一块）。计时的词保留原来的前导空白；拆开的一块只换它在原文里的那一段。
 * 改成空的等于删掉（见 `hideWords`）。不是转写正文、找不到这个词或没有变化时返回 null。
 */
export function editWordText(body: unknown, id: string, text: string): Json | null {
  const next = text.trim();
  if (!next) return hideWords(body, [id]);
  const doc = speechWords(body);
  const at = doc?.index.get(rawWordId(id));
  if (!doc || at === undefined) return null;
  const word = doc.words[at]!;
  const old = typeof word.text === 'string' ? word.text : '';
  let value: string;
  if (untimed(word)) {
    const span = pieceSpans(old)[pieceNumber(id) - 1];
    if (!span) return null;
    value = splice(old, span, next);
  } else {
    value = (/^\s*/.exec(old)?.[0] ?? '') + next;
  }
  if (value === old) return null;
  doc.words[at] = { ...word, text: value };
  return { ...doc.body, words: doc.words };
}

/**
 * 删掉一些词的文字（不动时间线）：计时的词标成 `hidden: true`；拆开的未计时段只删掉选中的那几块，整段都删了才标隐藏。
 * 不是转写正文或什么都没变时返回 null。
 */
export function hideWords(body: unknown, ids: readonly string[]): Json | null {
  const doc = speechWords(body);
  if (!doc) return null;
  const byRaw = new Map<string, Set<number>>();
  for (const id of ids) {
    const raw = rawWordId(id);
    const set = byRaw.get(raw) ?? new Set<number>();
    set.add(pieceNumber(id));
    byRaw.set(raw, set);
  }
  let changed = false;
  for (const [raw, pieces] of byRaw) {
    const at = doc.index.get(raw);
    if (at === undefined) continue;
    const word = doc.words[at]!;
    if (word.hidden === true) continue;
    const old = typeof word.text === 'string' ? word.text : '';
    const spans = untimed(word) ? pieceSpans(old) : [];
    if (spans.length > 1 && [...pieces].some((n) => n <= spans.length) && spans.some((_, n) => !pieces.has(n + 1))) {
      let value = old;
      for (let n = spans.length; n >= 1; n--) if (pieces.has(n)) value = splice(value, spans[n - 1]!, '');
      doc.words[at] = { ...word, text: value };
    } else {
      doc.words[at] = { ...word, hidden: true };
    }
    changed = true;
  }
  return changed ? { ...doc.body, words: doc.words } : null;
}

/**
 * 由这份转写生成、但生成时用的转写版本不是现在这版的字幕（只看时间线上的字幕实例用到的）：改原文之后它们过期了，
 * 不自动重新生成。
 */
export function staleCaptions(sequence: Sequence, documents: Record<Id, DocumentRecord>, speech: DocumentRecord): DocumentRecord[] {
  const used = new Set(sequence.items.flatMap((item) => (item.type === 'caption' ? [item.documentId] : [])));
  return [...used].flatMap((id) => {
    const record = documents[id];
    const source = record?.extensions?.[SPEECH_CAPTION_EXTENSION];
    if (!record || record.kind !== 'caption' || !isObject(source) || source.speechDocumentId !== speech.id) return [];
    return source.speechRevision === speech.currentRevision ? [] : [record];
  });
}
