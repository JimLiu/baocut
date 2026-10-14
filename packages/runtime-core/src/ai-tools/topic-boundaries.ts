import type { Id, SemanticReason } from '@baocut/protocol';
import { reasonOf } from '../space/semantic/errors.ts';
import type { TopicUnit } from '../space/semantic/context.ts';
import type { ContextWord } from './ai-tool-prompt.ts';
import { chapterBoundaryCandidates, DEFAULT_BOUNDARY_OPTIONS, type BoundaryChunk, type BoundaryOptions } from './chapter-boundaries.ts';

/**
 * 按话题找章节边界（创作辅助集成设计 §3.6），AI 工具「生成章节」（`boundaries: 'topic'`）与智能体工具
 * `speech_topic_boundaries` 共用：
 *
 * 1. 这一版转写已经建好语义索引时，直接用索引里的句群与向量（不重新编码，句群粒度固定，与检索在同一个向量空间）。候选的时间
 *    吸到最近的段落开头（不远于 `SNAP_SEC`），吸不到时留在句子开头。
 * 2. 否则把时间线上的段落现算文档向量（段落太长时截断）。
 * 3. 没有语义模型时由模型决定边界，原因写进结果；没找到转折时也由模型决定（候选 0）。
 *
 * 这一版有画面索引时，每个候选另给 `visualShift`：转折前后各 `VISUAL_WINDOW_SEC` 秒里关键帧的平均向量差多远。只作佐证（讲话
 * 转了题、画面也换了更像章节），不参与打分；未校准。
 */
export interface TopicBoundaryDeps {
  /** 当前版本语义索引里这份转写的句群与向量；没有时 null。 */
  topicUnits?(videoId: Id, documentId: Id): Promise<TopicUnit[] | null>;
  /** 给一组文字算文档向量（L2 归一化）；模型不可用时抛带原因码的错误。 */
  embed?(texts: string[], signal: AbortSignal): Promise<Float32Array[]>;
  /** 当前版本画面索引里时间线上的关键帧与向量（按时间排）；没有时 null。 */
  timelineFrames?(videoId: Id): Promise<{ at: number; vector: Float32Array }[] | null>;
}

export interface TopicBoundaryCandidate {
  /** 新章节从这里开始（时间线秒）：段落或句子的开头。 */
  at: number;
  /** 连贯度在这里的落差（越大转折越明显）；同一部视频里的候选之间可以比，不同视频之间不能比。 */
  depth: number;
  /** 深度高出这部视频全部间隔的中位数多少个 MAD。 */
  score: number;
  /** 边界前的最后一点与之后的开头一点原文。 */
  before: string;
  after: string;
  /** 转折前后画面的差异（1 − 两侧关键帧平均向量的余弦，0 是一样）；没有这一版的画面索引、或一侧没有帧时没有。 */
  visualShift?: number;
}

export interface TopicBoundaries {
  mode: 'topic' | 'model';
  /** 向量从哪来：索引里的句群，或现算的段落；没有算时 null。 */
  source: 'index' | 'embedded' | null;
  reason: SemanticReason | null;
  /** 第一段的起点（第一章从这里开始）；没有文稿时 null。 */
  first: number | null;
  /** 按时间排。 */
  candidates: TopicBoundaryCandidate[];
}

/** 现算向量时一段最多取这么多字符（只为判断话题，不发给文本模型）。 */
const BOUNDARY_TEXT_CHARS = 1200;
/** 候选前后各给这么多字符的原文。 */
export const BOUNDARY_CONTEXT_CHARS = 160;
/** 索引句群的边界吸到段落开头时最多挪这么多秒。 */
const SNAP_SEC = 15;
/** 索引的时间线终点与现在的文稿终点相差超过这么多秒时，不信这份索引（时间线改过还没重建），改为现算。 */
const INDEX_END_TOLERANCE_SEC = 1;
/** 比画面时转折前后各取这么多秒的关键帧（每 8 秒一帧，约三帧）。 */
const VISUAL_WINDOW_SEC = 24;

interface Paragraph {
  start: number;
  end: number;
  text: string;
}

export async function topicBoundaries(
  deps: TopicBoundaryDeps,
  input: { videoId: Id; documentId: Id; words: readonly ContextWord[] },
  signal: AbortSignal,
  options: Partial<BoundaryOptions> = {},
): Promise<TopicBoundaries> {
  const paragraphs = paragraphsOf(input.words);
  const first = paragraphs[0]?.start ?? null;
  const fallback = (reason: SemanticReason | null, source: TopicBoundaries['source'] = null): TopicBoundaries => ({
    mode: 'model',
    source,
    reason,
    first,
    candidates: [],
  });
  if (first === null) return fallback(null);
  const merged = { ...DEFAULT_BOUNDARY_OPTIONS, ...options };
  const finish = async (candidates: TopicBoundaryCandidate[], source: 'index' | 'embedded'): Promise<TopicBoundaries> => {
    if (candidates.length === 0) return fallback(null, source);
    const frames = deps.timelineFrames ? await deps.timelineFrames(input.videoId).catch(() => null) : null;
    return { mode: 'topic', source, reason: null, first, candidates: frames && frames.length > 0 ? withVisualShift(candidates, frames) : candidates };
  };

  const units = deps.topicUnits ? await deps.topicUnits(input.videoId, input.documentId).catch(() => null) : null;
  const end = Math.max(...paragraphs.map((p) => p.end));
  if (units && units.length >= 3 && Math.abs(Math.max(...units.map((u) => u.end)) - end) <= INDEX_END_TOLERANCE_SEC) {
    const chunks = units.map((u, i) => ({ start: u.start, end: Math.max(u.end, units[i + 1]?.start ?? u.end), vector: u.vector }));
    const result = chapterBoundaryCandidates(chunks, merged);
    const starts = paragraphs.map((p) => p.start);
    const snapped = result.candidates.map((c) => ({
      at: snap(c.at, starts),
      depth: c.depth,
      score: c.score,
      before: units[c.before]!.text.slice(-BOUNDARY_CONTEXT_CHARS),
      after: units[c.after]!.text.slice(0, BOUNDARY_CONTEXT_CHARS),
    }));
    return finish(spaced(snapped, first, end, merged.minChapterSec), 'index');
  }

  if (!deps.embed) return fallback('MODEL_NOT_INSTALLED');
  if (paragraphs.length < 3) return fallback(null);
  let vectors: Float32Array[];
  try {
    vectors = await deps.embed(paragraphs.map((p) => p.text.slice(0, BOUNDARY_TEXT_CHARS)), signal);
  } catch (error) {
    if (signal.aborted) throw error;
    return fallback(reasonOf(error));
  }
  const chunks: BoundaryChunk[] = paragraphs.map((p, i) => ({ start: p.start, end: Math.max(p.end, paragraphs[i + 1]?.start ?? p.end), vector: vectors[i]! }));
  const result = chapterBoundaryCandidates(chunks, merged);
  return finish(
    result.candidates.map((c) => ({
      at: c.at,
      depth: c.depth,
      score: c.score,
      before: paragraphs[c.before]!.text.slice(-BOUNDARY_CONTEXT_CHARS),
      after: paragraphs[c.after]!.text.slice(0, BOUNDARY_CONTEXT_CHARS),
    })),
    'embedded',
  );
}

/** 每个候选前后各 `VISUAL_WINDOW_SEC` 秒的关键帧平均向量之间的余弦距离。 */
function withVisualShift(candidates: TopicBoundaryCandidate[], frames: readonly { at: number; vector: Float32Array }[]): TopicBoundaryCandidate[] {
  const mean = (picked: readonly { vector: Float32Array }[]): Float32Array | null => {
    if (picked.length === 0) return null;
    const sum = new Float32Array(picked[0]!.vector.length);
    for (const { vector } of picked) for (let i = 0; i < sum.length; i++) sum[i]! += vector[i]!;
    return sum;
  };
  return candidates.map((c) => {
    const before = mean(frames.filter((f) => f.at < c.at && f.at >= c.at - VISUAL_WINDOW_SEC));
    const after = mean(frames.filter((f) => f.at >= c.at && f.at < c.at + VISUAL_WINDOW_SEC));
    if (!before || !after) return c;
    let dot = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < before.length; i++) {
      dot += before[i]! * after[i]!;
      a += before[i]! * before[i]!;
      b += after[i]! * after[i]!;
    }
    const cosine = a > 0 && b > 0 ? dot / Math.sqrt(a * b) : 1;
    return { ...c, visualShift: Math.max(0, 1 - cosine) };
  });
}

/** 时间线上的段落：词按 `paragraphStart` 分组（中日文字不加空格）。 */
function paragraphsOf(words: readonly ContextWord[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const w of words) {
    const last = paragraphs[paragraphs.length - 1];
    if (!last || w.paragraphStart) paragraphs.push({ start: w.start, end: w.end ?? w.start, text: w.text });
    else {
      last.text += /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(w.text) ? w.text : ` ${w.text}`;
      last.end = Math.max(last.end, w.end ?? w.start);
    }
  }
  return paragraphs;
}

/** 吸到最近的段落开头（不远于 `SNAP_SEC`）；吸不到时原样（句子开头）。 */
function snap(at: number, starts: readonly number[]): number {
  let best = at;
  let distance = SNAP_SEC;
  for (const start of starts) {
    const d = Math.abs(start - at);
    if (d <= distance) {
      best = start;
      distance = d;
    }
  }
  return best;
}

/** 吸附之后再按深度收一遍：同一时刻只留一个，离首尾或已留的边界不足最短章节长度的丢掉。 */
function spaced(candidates: TopicBoundaryCandidate[], first: number, end: number, minChapterSec: number): TopicBoundaryCandidate[] {
  const kept: TopicBoundaryCandidate[] = [];
  for (const c of [...candidates].sort((a, b) => b.depth - a.depth || a.at - b.at)) {
    if (c.at - first < minChapterSec || end - c.at < minChapterSec) continue;
    if (kept.some((k) => Math.abs(k.at - c.at) < minChapterSec)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => a.at - b.at);
}
