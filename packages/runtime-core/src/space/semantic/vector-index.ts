import type { SemanticStore, StoredChunk, StoredFrame, VectorPartition, VisualPartition } from './store.ts';

/**
 * 精确向量扫描（EmbeddingGemma 2 检索集成方案 v0.1 §8.4）。调用方先由权限与筛选得出允许的世代（每个视频一个分区），
 * 只在这些分区里算余弦；不存在「先全库取 Top-K 再删掉没权限的」这条路。
 *
 * `VectorScanner` 是接口：首版在主线程里扫（512 维 FP32、单个视频几百个 chunk，一次查询通常只有几毫秒；分区按需从库里读进内存
 * 并缓存，世代切换时作废）。库大到主线程扫描影响事件循环（§16.2 的 P95 < 50ms）时，换成 `worker_threads` 或原生 SIMD 实现，
 * SearchService 与权限合同不变。
 */

export interface ScanHit {
  chunk: StoredChunk;
  /** 余弦（向量都已 L2 归一化，就是点积）。只用于排序与阈值，不是置信度。 */
  score: number;
}

/** 画面世代里的一帧命中。 */
export interface FrameScanHit {
  frame: StoredFrame;
  score: number;
}

/**
 * 一次扫描算过的全部余弦的累计（个数、和、平方和）：检索按这次查询在允许范围内的分数分布把余弦换成标准分（§10.2）。扫描本来
 * 就算了范围内每一个向量，顺手累计不多花时间。
 */
export interface ScanStats {
  count: number;
  sum: number;
  sumSq: number;
}

export function emptyScanStats(): ScanStats {
  return { count: 0, sum: 0, sumSq: 0 };
}

export interface VectorScanner {
  /**
   * 在这些世代（分区）里取与查询最近的 `k` 个；`filter` 再按 chunk 的元数据（文档种类）筛。给 `stats` 时把扫过（筛过）的每个
   * 余弦累计进去。
   */
  exactSearch(query: Float32Array, generationIds: readonly number[], k: number, filter?: (chunk: StoredChunk) => boolean, stats?: ScanStats): ScanHit[];
  /** 同上，在画面世代（关键帧）里找。 */
  exactFrameSearch(query: Float32Array, generationIds: readonly number[], k: number, stats?: ScanStats): FrameScanHit[];
  /** 世代换了或被撤下：丢掉缓存的分区。不给时全部丢掉。 */
  invalidate(generationIds?: readonly number[]): void;
}

/** 缓存的分区向量总数上限（约 100k × 512 × 4 字节 ≈ 200 MiB）；超出时丢掉最早读入的分区。 */
const CACHE_MAX_FLOATS = 100_000 * 512;

export class InThreadVectorScanner implements VectorScanner {
  readonly #store: () => SemanticStore | null;
  /** 文字与画面的世代都在 `generations` 表里，ID 不重复，共用一个缓存。 */
  readonly #cache = new Map<number, VectorPartition | VisualPartition>();
  #floats = 0;
  /** 读过的分区（测试用：确认扫描没有碰范围之外的世代）。 */
  readonly touched = new Set<number>();

  constructor(store: () => SemanticStore | null) {
    this.#store = store;
  }

  exactSearch(query: Float32Array, generationIds: readonly number[], k: number, filter?: (chunk: StoredChunk) => boolean, stats?: ScanStats): ScanHit[] {
    const top = new TopK<StoredChunk>(k);
    for (const id of generationIds) {
      const partition = this.#partition(id, 'text');
      if (!partition || !('chunks' in partition)) continue;
      this.touched.add(id);
      scan(query, partition.vectors, partition.generation.dims, partition.chunks, top, filter, stats);
    }
    return top.items.map(({ item, score }) => ({ chunk: item, score })).sort((a, b) => b.score - a.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId));
  }

  exactFrameSearch(query: Float32Array, generationIds: readonly number[], k: number, stats?: ScanStats): FrameScanHit[] {
    const top = new TopK<StoredFrame>(k);
    for (const id of generationIds) {
      const partition = this.#partition(id, 'visual');
      if (!partition || !('frames' in partition)) continue;
      this.touched.add(id);
      scan(query, partition.vectors, partition.generation.dims, partition.frames, top, undefined, stats);
    }
    return top.items
      .map(({ item, score }) => ({ frame: item, score }))
      .sort((a, b) => b.score - a.score || a.frame.generationId - b.frame.generationId || a.frame.ord - b.frame.ord);
  }

  invalidate(generationIds?: readonly number[]): void {
    const ids = generationIds ?? [...this.#cache.keys()];
    for (const id of ids) {
      const partition = this.#cache.get(id);
      if (!partition) continue;
      this.#floats -= partition.vectors.length;
      this.#cache.delete(id);
    }
  }

  #partition(id: number, channel: 'text' | 'visual'): VectorPartition | VisualPartition | null {
    const cached = this.#cache.get(id);
    if (cached) return cached;
    const store = this.#store();
    const partition = (channel === 'text' ? store?.partition(id) : store?.visualPartition(id)) ?? null;
    if (!partition) return null;
    this.#cache.set(id, partition);
    this.#floats += partition.vectors.length;
    for (const [other, old] of this.#cache) {
      if (this.#floats <= CACHE_MAX_FLOATS || other === id) break;
      this.#cache.delete(other);
      this.#floats -= old.vectors.length;
    }
    return partition;
  }
}

/** 前 `k` 个（按分数从高到低）。 */
class TopK<T> {
  readonly items: { item: T; score: number }[] = [];
  readonly k: number;
  constructor(k: number) {
    this.k = k;
  }

  push(item: T, score: number): void {
    const { items, k } = this;
    if (k <= 0) return;
    if (items.length < k) {
      items.push({ item, score });
      if (items.length === k) items.sort((a, b) => b.score - a.score);
    } else if (score > items[k - 1]!.score) {
      items[k - 1] = { item, score };
      for (let j = k - 1; j > 0 && items[j]!.score > items[j - 1]!.score; j--) [items[j], items[j - 1]] = [items[j - 1]!, items[j]!];
    }
  }
}

function scan<T>(
  query: Float32Array,
  vectors: Float32Array,
  dims: number,
  items: readonly T[],
  top: TopK<T>,
  filter?: (item: T) => boolean,
  stats?: ScanStats,
): void {
  if (dims !== query.length) return;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (filter && !filter(item)) continue;
    let dot = 0;
    const base = i * dims;
    for (let d = 0; d < dims; d++) dot += vectors[base + d]! * query[d]!;
    top.push(item, dot);
    if (stats) {
      stats.count++;
      stats.sum += dot;
      stats.sumSq += dot * dot;
    }
  }
}

/** 两个已归一化向量的余弦。 */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}
