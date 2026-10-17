import {
  ASR_RESULT_SCHEMA,
  canonicalLanguageTag,
  estimateWords,
  fixWordTimes,
  isHanIdeograph,
  secondsToTicks,
  type AsrCost,
  type AsrResult,
  type AsrWarning,
  type LanguageOption,
  type Segment,
  type Word,
} from '@baocut/models';
import type { ChunkTranscript } from './adapter.ts';
import { ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

/**
 * 把各块的转写拼成 `baocut.asr-result/v1`（架构设计 §6.4、§6.6）：时间换回素材时钟的整数 tick；供应商给的词时间
 * 标 `provider`，没有词时间的段按字符长度插值、标 `estimated`（与 Model Worker 的规则相同，见 `word-timing.ts`）。
 *
 * - 有段：词按中点归到所在的段（落在段外的归到最近的段）；
 * - 只有词：按停顿（> 0.8 秒）、句末标点、段长（> 30 秒）分段；
 * - 只有文本：整块一段；
 * - 词时间先按供应商给的顺序查一遍：个别离群的时间（在线模型偶尔丢或多一位数字，例如 13.4 秒写成 `3.400s`）
 *   按前后可信的时间插值修好、标 `estimated`（见 {@link repairWordTimes}），免得一个坏点经排序与单调修正把整块拖塌；
 * - 段按起点排好后去掉重叠（与 Model Worker 相同，见 {@link resolveOverlaps}）：整个落在前一段里的插话挪到那段的尾巴上；
 *   换算之后没有长度的段丢弃，记 `segment-degenerate`；
 * - 挪过、词时间修正或修补过的段记 `timing-adjusted`。
 */

export interface ChunkResult {
  /** 这一块在解码音频里的起止（秒，相对解码起点）。 */
  startSec: number;
  endSec: number;
  transcript: ChunkTranscript;
}

export interface ResultContext {
  providerId: string;
  modelId: string;
  workerVersion: string;
  contentHash: string;
  runGeneration: number;
  timescale: number;
  language: LanguageOption;
  /** 解码起点在素材时钟上的位置（秒）：请求了 range 时是它的起点。 */
  offsetSec: number;
}

interface RawWord {
  start: number;
  end: number;
  text: string;
  confidence: number | null;
  /** 时间是离群值、按前后插值修补过的。 */
  repaired?: boolean;
}

interface RawSegment {
  start: number;
  end: number;
  text: string;
  words: RawWord[];
}

const SEGMENT_GAP_SEC = 0.8;
const SEGMENT_MAX_SEC = 30;
const SENTENCE_END = /[。！？!?…]$|[^.]\.$/u;
/** 词时间的回退在这个范围内算正常的重叠（交给单调修正），超出才算离群。 */
const OUTLIER_TOLERANCE_SEC = 1;

export function buildAsrResult(input: {
  chunks: readonly ChunkResult[];
  context: ResultContext;
  /** 实际解码出来的音频长度（秒）。 */
  decodedSec: number;
  warnings?: AsrWarning[];
}): AsrResult {
  const { context } = input;
  const ticks = (seconds: number) => secondsToTicks(context.offsetSec + seconds, context.timescale);
  const duration = ticks(input.decodedSec);
  const warnings: AsrWarning[] = [...(input.warnings ?? [])];
  const raw = input.chunks.flatMap(chunkSegments).sort((a, b) => a.start - b.start || a.end - b.end);
  const moved = resolveOverlaps(raw);
  const languageHint = context.language.tag ?? firstDetected(input.chunks);

  const segments: Segment[] = [];
  let previousEnd = 0;
  for (const s of raw) {
    const start = Math.max(ticks(s.start), previousEnd);
    const end = Math.min(ticks(s.end), duration);
    if (end <= start) {
      warnings.push({ code: 'segment-degenerate', detail: PH.segmentDropped({ text: s.text.slice(0, 40) }).text });
      continue;
    }
    const id = `seg-${String(segments.length + 1).padStart(4, '0')}`;
    const words: Word[] =
      s.words.length > 0
        ? s.words.map((w) => ({
            start: ticks(w.start),
            end: ticks(w.end),
            text: w.text,
            confidence: w.confidence,
            timingQuality: w.repaired ? ('estimated' as const) : ('provider' as const),
          }))
        : estimateWords(s.text, languageHint, start, end).map((w) => ({
            start: Math.round(w.start),
            end: Math.round(w.end),
            text: w.text,
            confidence: null,
            timingQuality: 'estimated' as const,
          }));
    const segment: Segment = { id, start, end, text: s.text, speakerId: null, words };
    if (fixWordTimes(segment) || moved.has(s) || s.words.some((w) => w.repaired)) warnings.push({ code: 'timing-adjusted', segmentId: id });
    segments.push(segment);
    previousEnd = end;
  }

  return {
    schema: ASR_RESULT_SCHEMA,
    outcome: segments.length > 0 ? 'transcribed' : 'no-speech',
    timescale: context.timescale,
    clock: 'source-asset',
    duration,
    language: languageOf(context.language, input.chunks),
    segments,
    speakers: [],
    coverage: [{ start: Math.min(ticks(0), duration), end: duration }],
    warnings,
    provenance: provenanceOf(context, costOf(input.chunks)),
  };
}

/**
 * 去掉段之间的重叠（`segments` 已按起点排好，原地改写起止），规则与 Model Worker 相同（Model Worker 协议规范
 * §2.5.1）：与前一段部分重叠的在重叠区的中点分开；整个落在前一段里的（多人同时说话时的插话）从中点分会倒挂，
 * 改为按原时长从包住它的那段的尾巴上分出来，几段插话合起来至多分走那段的一半（超出时按比例缩短），词跟着平移。
 * 其余段的分法与没有插话时相同。返回这样挪过的段。
 */
export function resolveOverlaps(segments: RawSegment[]): Set<RawSegment> {
  const nested: Array<{ outer: RawSegment; inner: RawSegment }> = [];
  let previous: RawSegment | undefined;
  for (const segment of segments) {
    if (!previous) {
      previous = segment;
      continue;
    }
    // 下一段到来之前，前一段的终点还是原来的终点。
    if (segment.end < previous.end) {
      nested.push({ outer: previous, inner: segment });
      continue;
    }
    if (segment.start < previous.end) {
      const middle = (segment.start + previous.end) / 2;
      previous.end = middle;
      segment.start = middle;
    }
    previous = segment;
  }

  const moved = new Set<RawSegment>();
  for (let first = 0; first < nested.length; ) {
    const outer = nested[first]!.outer;
    let next = first;
    while (next < nested.length && nested[next]!.outer === outer) next++;
    const group = nested.slice(first, next).map((pair) => pair.inner);
    first = next;
    const slotEnd = outer.end;
    const total = group.reduce((sum, inner) => sum + (inner.end - inner.start), 0);
    const room = Math.min(total, (outer.end - outer.start) / 2);
    const scale = total > 0 ? room / total : 0;
    let cursor = slotEnd - room;
    outer.end = cursor;
    group.forEach((inner, index) => {
      const end = index === group.length - 1 ? slotEnd : Math.min(cursor + (inner.end - inner.start) * scale, slotEnd);
      const delta = cursor - inner.start;
      inner.words = inner.words.map((w) => ({ ...w, start: w.start + delta, end: w.end + delta }));
      inner.start = cursor;
      inner.end = end;
      cursor = end;
      moved.add(inner);
    });
  }
  return moved;
}

/** 素材没有所选音轨时的结果。 */
export function noAudioResult(context: ResultContext): AsrResult {
  return {
    schema: ASR_RESULT_SCHEMA,
    outcome: 'no-audio-track',
    timescale: context.timescale,
    clock: 'source-asset',
    duration: 0,
    language: languageOf(context.language, []),
    segments: [],
    speakers: [],
    coverage: [],
    warnings: [],
    provenance: provenanceOf(context, { status: 'unknown' }),
  };
}

/** 一块的段，时间换成相对解码起点的秒，并夹在这一块之内。 */
export function chunkSegments(chunk: ChunkResult): RawSegment[] {
  const t = chunk.transcript;
  const length = Math.max(0, chunk.endSec - chunk.startSec);
  const at = (seconds: number) => chunk.startSec + Math.min(Math.max(seconds, 0), length);
  const valid = (t.words ?? []).filter(
    (w) => Number.isFinite(w.start) && Number.isFinite(w.end) && typeof w.text === 'string' && w.text.trim() !== '',
  );
  const words: RawWord[] = repairWordTimes(valid, length)
    .map((w) => ({
      start: at(Math.min(w.start, w.end)),
      end: at(Math.max(w.start, w.end)),
      text: w.text.trim(),
      confidence: typeof w.confidence === 'number' && w.confidence >= 0 && w.confidence <= 1 ? w.confidence : null,
      ...(w.repaired ? { repaired: true } : {}),
    }))
    .sort((a, b) => a.start - b.start);

  const declared = (t.segments ?? [])
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && typeof s.text === 'string' && s.text.trim() !== '')
    .map((s) => ({ start: at(Math.min(s.start, s.end)), end: at(Math.max(s.start, s.end)), text: s.text.trim(), words: [] as RawWord[] }))
    .sort((a, b) => a.start - b.start);
  if (declared.length > 0) {
    for (const word of words) nearestSegment(declared, (word.start + word.end) / 2).words.push(word);
    return declared;
  }
  if (words.length > 0) return groupWords(words);
  const text = t.text.trim();
  return text ? [{ start: chunk.startSec, end: chunk.startSec + length, text, words: [] }] : [];
}

/**
 * 修补供应商给的词时间里的离群值（秒，相对这一块；`words` 按供应商给的顺序，即说话的顺序）。
 *
 * 把起止依次排成一列时间点，取最长的不减子序列作为可信的骨架（越出 `[0, length]` 一秒以上的点先排除）；
 * 不在骨架上、但离前后骨架点不超过一秒的点（相邻词的正常重叠）照样可信；其余的点按前后可信的点线性插值
 * （没有可信的点时以块的起止为界），所在的词记 `repaired`。只有零星的坏点会被修掉：正常的时间整体是不减的。
 */
export function repairWordTimes<W extends { start: number; end: number }>(
  words: readonly W[],
  length: number,
): Array<W & { repaired?: boolean }> {
  const points = words.flatMap((w) => [w.start, w.end]);
  const inRange = points.map((p) => p >= -OUTLIER_TOLERANCE_SEC && p <= length + OUTLIER_TOLERANCE_SEC);
  const backbone = longestNonDecreasing(points, inRange);
  const trusted = [...backbone];
  let previous = -1;
  for (let i = 0; i < points.length; i++) {
    if (backbone[i]) {
      previous = i;
      continue;
    }
    if (!inRange[i]) continue;
    let next = i + 1;
    while (next < points.length && !backbone[next]) next++;
    const low = previous >= 0 ? points[previous]! : 0;
    const high = next < points.length ? points[next]! : length;
    trusted[i] = points[i]! >= low - OUTLIER_TOLERANCE_SEC && points[i]! <= high + OUTLIER_TOLERANCE_SEC;
  }
  if (trusted.every(Boolean)) return [...words];

  const fixed = [...points];
  for (let i = 0; i < points.length; ) {
    if (trusted[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < points.length && !trusted[j]) j++;
    const lowIndex = i - 1;
    const low = lowIndex >= 0 ? points[lowIndex]! : 0;
    const high = j < points.length ? points[j]! : length;
    const span = j - lowIndex;
    for (let k = i; k < j; k++) fixed[k] = Math.min(Math.max(low + ((high - low) * (k - lowIndex)) / span, 0), length);
    i = j;
  }
  return words.map((w, index) => {
    const start = fixed[index * 2]!;
    const end = fixed[index * 2 + 1]!;
    return trusted[index * 2] && trusted[index * 2 + 1] ? w : { ...w, start, end, repaired: true };
  });
}

/** 最长不减子序列（只在 `eligible` 的点里取），返回每个点是否在其中。O(n log n)。 */
function longestNonDecreasing(values: readonly number[], eligible: readonly boolean[]): boolean[] {
  const tails: number[] = [];
  const parent = new Array<number>(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    if (!eligible[i]) continue;
    const value = values[i]!;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]!]! <= value) lo = mid + 1;
      else hi = mid;
    }
    parent[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  }
  const member = new Array<boolean>(values.length).fill(false);
  for (let i = tails.length > 0 ? tails.at(-1)! : -1; i >= 0; i = parent[i]!) member[i] = true;
  return member;
}

function nearestSegment(segments: RawSegment[], point: number): RawSegment {
  let best = segments[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const distance = point < segment.start ? segment.start - point : point > segment.end ? point - segment.end : 0;
    if (distance < bestDistance) {
      best = segment;
      bestDistance = distance;
    }
  }
  return best;
}

/** 只有词时：按停顿、句末标点与段长分段。 */
export function groupWords(words: readonly RawWord[]): RawSegment[] {
  const segments: RawSegment[] = [];
  let current: RawWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      start: current[0]!.start,
      end: Math.max(...current.map((w) => w.end)),
      text: joinWords(current.map((w) => w.text)),
      words: current,
    });
    current = [];
  };
  for (const word of words) {
    const last = current.at(-1);
    if (
      last &&
      (word.start - last.end > SEGMENT_GAP_SEC || SENTENCE_END.test(last.text) || word.end - current[0]!.start > SEGMENT_MAX_SEC)
    ) {
      flush();
    }
    current.push(word);
  }
  flush();
  return segments;
}

/** 把词拼回文本：中日文之间、标点之前不加空格，其余用空格隔开。 */
export function joinWords(words: readonly string[]): string {
  let out = '';
  for (const word of words) {
    if (out && needsSpace(out.at(-1)!, word[0]!)) out += ' ';
    out += word;
  }
  return out;
}

function needsSpace(before: string, after: string): boolean {
  if (isCjk(before) || isCjk(after)) return false;
  return !/[,.!?;:%)\]}'’”]/u.test(after);
}

function isCjk(char: string): boolean {
  return isHanIdeograph(char) || /[　-ヿ＀-￯]/u.test(char);
}

function firstDetected(chunks: readonly ChunkResult[]): string | null {
  for (const chunk of chunks) {
    const tag = chunk.transcript.language ? canonicalLanguageTag(chunk.transcript.language) : null;
    if (tag) return tag;
  }
  return null;
}

function languageOf(option: LanguageOption, chunks: readonly ChunkResult[]): AsrResult['language'] {
  if (option.mode === 'assert') return { tag: option.tag, source: 'asserted', confidence: null };
  const detected = firstDetected(chunks);
  if (detected) return { tag: detected, source: 'detected', confidence: null };
  return { tag: option.tag ? canonicalLanguageTag(option.tag) : null, source: 'unknown', confidence: null };
}

/** 每一块都报告了用量才是 `reported`（一块时原样，多块时是数组）；否则 `unknown`，不拿部分用量充数。 */
function costOf(chunks: readonly ChunkResult[]): AsrCost {
  const usage = chunks.map((c) => c.transcript.usage).filter((u) => u !== undefined && u !== null);
  if (chunks.length === 0 || usage.length !== chunks.length) return { status: 'unknown' };
  return { status: 'reported', usage: usage.length === 1 ? usage[0] : usage };
}

function provenanceOf(context: ResultContext, cost: AsrCost): AsrResult['provenance'] {
  return {
    provider: context.providerId,
    bundleId: null,
    models: { asr: { family: context.providerId, revision: context.modelId } },
    backend: 'online',
    device: 'remote',
    workerVersion: context.workerVersion,
    inputHash: context.contentHash,
    runGeneration: context.runGeneration,
    cost,
  };
}
