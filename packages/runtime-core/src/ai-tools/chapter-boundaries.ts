/**
 * 章节边界候选（创作辅助集成设计 §3.6）：按 TextTiling 的做法，每两个相邻句群之间取前后各 `window` 个句群的平均向量，
 * 两边的余弦相似度是这里的「连贯度」；连贯度向两侧爬到各自的高点，落差之和是这里的「深度」。候选是深度的局部极大值且超过
 * 自适应阈值（深度的中位数 + k·MAD），再按最短章节长度与最多章节数收拢。比较一段窗口而不是只比相邻两个句群，一句插话或一个
 * 很短的离题不会单独成为转折；看落差而不是绝对距离，整部视频话题都很散或都很集中时阈值也跟着走。
 *
 * 只做确定性的数学：同一组向量结果不变，生成章节时文本模型只在候选处分章（可以合并，不能新增）。k、窗口、最短章节长度
 * 都是待校准的默认值（`semantic-thresholds.json` 的 `chapterBoundary`，UNCALIBRATED；校准脚本见 `tools/embedding-eval/`）。
 */

import { SEMANTIC_THRESHOLDS } from '../space/semantic/thresholds.ts';

/** 时间线上的一个句群：起止（秒，`sequence` 时钟）与 L2 归一化的文档向量。 */
export interface BoundaryChunk {
  start: number;
  end: number;
  vector: Float32Array;
}

export interface BoundaryOptions {
  /** 深度的阈值 = 中位数 + k·MAD。 */
  k: number;
  /** 边界两侧各取几个句群求平均（至少 1，即只比相邻两个）。 */
  window: number;
  /** 两个边界（以及边界与时间线首尾）之间至少隔这么多秒。 */
  minChapterSec: number;
  /** 最多这么多章（边界数 + 1）；超出时留漂移最大的。 */
  maxChapters: number;
}

/** 阈值高出中位数的最小余量（深度）：只为挡住浮点误差，不是话题判断。 */
const MIN_MARGIN = 1e-4;
/** 连贯度相差不到这么多算一样高（爬坡时跨过浮点抖动，平台不会被抖动切成几个小坑）。 */
const FLAT = 1e-6;

const TUNED = SEMANTIC_THRESHOLDS.chapterBoundary;
export const DEFAULT_BOUNDARY_OPTIONS: BoundaryOptions = {
  k: TUNED.k.value,
  window: TUNED.window.value,
  minChapterSec: TUNED.minChapterSec.value,
  maxChapters: TUNED.maxChapters.value,
};

/**
 * 一处候选：新章节从 `at`（后一个句群的起点）开始；`drift` 是两侧窗口之间的余弦距离，`depth` 是连贯度在这里的落差，
 * `score` 是深度高出中位数多少个 MAD。
 */
export interface BoundaryCandidate {
  at: number;
  /** 边界前后的句群序号（`chunks` 里的下标）：`before + 1 === after`。 */
  before: number;
  after: number;
  drift: number;
  depth: number;
  score: number;
}

export interface BoundaryResult {
  candidates: BoundaryCandidate[];
  /** 深度序列的中位数、MAD 与阈值（诊断与界面上的「为什么在这里」）。 */
  median: number;
  mad: number;
  threshold: number;
}

/** `chunks[from..to)` 的平均向量，L2 归一化（全零时原样）。 */
function centroid(chunks: readonly BoundaryChunk[], from: number, to: number): Float32Array {
  const dims = chunks[from]!.vector.length;
  const sum = new Float32Array(dims);
  for (let i = from; i < to; i++) {
    const v = chunks[i]!.vector;
    for (let d = 0; d < dims && d < v.length; d++) sum[d]! += v[d]!;
  }
  let norm = 0;
  for (let d = 0; d < dims; d++) norm += sum[d]! * sum[d]!;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let d = 0; d < dims; d++) sum[d]! /= norm;
  return sum;
}

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** 每个间隔的连贯度：前后各 `window` 个句群（不足时取到头为止）的平均向量之间的余弦相似度。 */
export function coherence(chunks: readonly BoundaryChunk[], window: number): number[] {
  const w = Math.max(1, Math.floor(window));
  const out: number[] = [];
  for (let i = 0; i + 1 < chunks.length; i++) {
    out.push(dot(centroid(chunks, Math.max(0, i - w + 1), i + 1), centroid(chunks, i + 1, Math.min(chunks.length, i + 1 + w))));
  }
  return out;
}

/** 每个间隔的深度：连贯度向左、向右各自爬到不再上升处（平的也接着走），两边高出这里的落差之和。 */
export function depthScores(sim: readonly number[]): number[] {
  return sim.map((s, i) => {
    let left = s;
    for (let j = i - 1; j >= 0 && sim[j]! >= left - FLAT; j--) left = Math.max(left, sim[j]!);
    let right = s;
    for (let j = i + 1; j < sim.length && sim[j]! >= right - FLAT; j++) right = Math.max(right, sim[j]!);
    return left - s + (right - s);
  });
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function chapterBoundaryCandidates(chunks: readonly BoundaryChunk[], options: Partial<BoundaryOptions> = {}): BoundaryResult {
  const { k, window, minChapterSec, maxChapters } = { ...DEFAULT_BOUNDARY_OPTIONS, ...options };
  const sim = coherence(chunks, window);
  const depth = depthScores(sim);
  const m = median(depth);
  const mad = median(depth.map((d) => Math.abs(d - m)));
  // 连贯度几乎都一样时深度与 MAD 都接近零：阈值至少高出中位数一点（浮点误差之外），没有转折就没有候选。
  const threshold = m + Math.max(k * mad, MIN_MARGIN);
  const peaks: BoundaryCandidate[] = [];
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]!;
    const left = i > 0 ? depth[i - 1]! : -Infinity;
    const right = i + 1 < depth.length ? depth[i + 1]! : -Infinity;
    // 局部极大：不小于两侧，平台只取第一个。
    if (!(d > threshold && d >= right && d > left)) continue;
    peaks.push({ at: chunks[i + 1]!.start, before: i, after: i + 1, drift: 1 - sim[i]!, depth: d, score: mad > 0 ? (d - m) / mad : Infinity });
  }
  if (chunks.length === 0) return { candidates: [], median: m, mad, threshold };
  const first = chunks[0]!.start;
  const last = chunks[chunks.length - 1]!.end;
  // 按深度从大到小收：离时间线首尾或已收的边界不足最短章节长度的丢掉（确定性：深度相同按时间先后）。
  const kept: BoundaryCandidate[] = [];
  for (const peak of [...peaks].sort((a, b) => b.depth - a.depth || a.at - b.at)) {
    if (kept.length + 1 >= maxChapters) break;
    if (peak.at - first < minChapterSec || last - peak.at < minChapterSec) continue;
    if (kept.some((other) => Math.abs(other.at - peak.at) < minChapterSec)) continue;
    kept.push(peak);
  }
  kept.sort((a, b) => a.at - b.at);
  return { candidates: kept, median: m, mad, threshold };
}
