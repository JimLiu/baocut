/**
 * 章节边界候选的校准（创作辅助集成设计 §3.6，`semantic-thresholds.json` 的 `chapterBoundary`）：拿作者自己分的章节当标准答案，
 * 在一组参数上跑 `chapterBoundaryCandidates`，看候选落在作者章节点 ±容差 秒内的精确率、召回率与 F1。
 *
 * 两步，都只读：
 *
 * 1. 导出数据集（`export`）：从一个 BaoCut 主目录的语义索引（`<home>/cache/semantic-index/v1/index.db`，只读打开）取每部视频
 *    当前世代里讲话转写的句群向量与时间（起点跳过与上一个句群重叠的句子，与 `SemanticContext.topicUnits` 同一规则），配上
 *    `--truth` 文件里的作者章节时间，写到 `--out`。不写文字，只写时间与向量。`--truth` 是 `{ "<videoId>": [秒, …] }`（时间线
 *    时间；没剪过的导入视频与来源时间相同），可从 `baocut videos inspect` 的 `assets[].source.chapters` 整理。
 * 2. 评分（`score`）：读数据集，在参数网格上评分，输出 JSON（只有汇总数字）。
 *
 *    node --experimental-strip-types tools/embedding-eval/chapter-boundaries-eval.ts export --home <dir> --truth <file> --out <file>
 *    node --experimental-strip-types tools/embedding-eval/chapter-boundaries-eval.ts score --dataset <file> [--tolerance 15] [--out <file>]
 *
 * 数据集与结果都放在仓库外（`$BAOCUT_EMBED_EVAL_ROOT/chapters-eval/`）：向量取自用户自己的视频。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chapterBoundaryCandidates, type BoundaryChunk, type BoundaryOptions } from '../../packages/runtime-core/src/ai-tools/chapter-boundaries.ts';

export interface DatasetVideo {
  videoId: string;
  units: { start: number; end: number; vector: number[] }[];
  /** 作者章节的起点（秒，时间线时间）；第一章的 0 也可以在里面，评分时不算边界。 */
  truth: number[];
}

export interface Dataset {
  schema: 'baocut.chapter-eval/1';
  videos: DatasetVideo[];
}

export interface ScoreRow extends BoundaryOptions {
  precision: number;
  recall: number;
  f1: number;
  /** 每部视频的候选数与作者边界数之差的平均（正数是候选多）。 */
  countBias: number;
}

/** 网格：k、窗口、最短章节长度；章数上限放开，看算法本身。 */
const GRID = {
  k: [0.5, 1, 1.5, 2, 3, 4],
  window: [1, 2, 3, 4],
  minChapterSec: [30, 60, 90, 120],
};
const MAX_CHAPTERS = 200;

/** 在 ±tolerance 秒内一一配对（贪心，按距离从近到远），返回配上的个数。 */
export function matched(candidates: readonly number[], truth: readonly number[], tolerance: number): number {
  const pairs: [number, number, number][] = [];
  candidates.forEach((c, i) => truth.forEach((t, j) => Math.abs(c - t) <= tolerance && pairs.push([Math.abs(c - t), i, j])));
  pairs.sort((a, b) => a[0] - b[0]);
  const usedC = new Set<number>();
  const usedT = new Set<number>();
  for (const [, i, j] of pairs) {
    if (usedC.has(i) || usedT.has(j)) continue;
    usedC.add(i);
    usedT.add(j);
  }
  return usedC.size;
}

export function score(dataset: Dataset, tolerance: number): ScoreRow[] {
  const rows: ScoreRow[] = [];
  const videos = dataset.videos.map((v) => {
    const chunks: BoundaryChunk[] = v.units.map((u) => ({ start: u.start, end: u.end, vector: Float32Array.from(u.vector) }));
    const first = chunks[0]?.start ?? 0;
    // 第一章的起点不是边界。
    const truth = v.truth.filter((t) => t > first + tolerance);
    return { chunks, truth };
  });
  for (const k of GRID.k)
    for (const window of GRID.window)
      for (const minChapterSec of GRID.minChapterSec) {
        const options: BoundaryOptions = { k, window, minChapterSec, maxChapters: MAX_CHAPTERS };
        let hits = 0;
        let predicted = 0;
        let actual = 0;
        let bias = 0;
        for (const v of videos) {
          const at = chapterBoundaryCandidates(v.chunks, options).candidates.map((c) => c.at);
          hits += matched(at, v.truth, tolerance);
          predicted += at.length;
          actual += v.truth.length;
          bias += at.length - v.truth.length;
        }
        const precision = predicted > 0 ? hits / predicted : 0;
        const recall = actual > 0 ? hits / actual : 0;
        const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        rows.push({ ...options, precision, recall, f1, countBias: videos.length > 0 ? bias / videos.length : 0 });
      }
  return rows.sort((a, b) => b.f1 - a.f1 || a.k - b.k || a.window - b.window || a.minChapterSec - b.minChapterSec);
}

/** 只读打开语义索引，导出 `truth` 里每部视频的讲话句群与向量。 */
export function exportDataset(home: string, truth: Record<string, number[]>): Dataset {
  const db = new DatabaseSync(path.join(home, 'cache', 'semantic-index', 'v1', 'index.db'), { readOnly: true });
  try {
    const videos: DatasetVideo[] = [];
    for (const [videoId, times] of Object.entries(truth)) {
      const generation = db
        .prepare(`SELECT g.id, g.dims FROM sources s JOIN generations g ON g.id = s.active_generation WHERE s.video_id = ? AND g.state = 'active'`)
        .get(videoId) as { id: number; dims: number } | undefined;
      if (!generation) continue;
      const chunks = db
        .prepare(
          `SELECT c.document_id, c.sentence_ids, gc.ord, gc.start, gc.end, gc.embedding_key FROM generation_chunks gc JOIN chunks c ON c.chunk_id = gc.chunk_id
           WHERE gc.generation_id = ? AND c.document_kind = 'speech' AND gc.clock = 'sequence' ORDER BY c.document_id, gc.ord`,
        )
        .all(generation.id) as { document_id: string | null; sentence_ids: string; ord: number; start: number; end: number; embedding_key: string }[];
      // 几份转写时取句群最多的那份。
      const counts = new Map<string | null, number>();
      for (const c of chunks) counts.set(c.document_id, (counts.get(c.document_id) ?? 0) + 1);
      const documentId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (documentId === undefined) continue;
      const rows = db
        .prepare(`SELECT sentence_ids, start FROM generation_sentences WHERE generation_id = ? AND document_kind = 'speech' AND clock = 'sequence' AND document_id IS ? ORDER BY ord`)
        .all(generation.id, documentId) as { sentence_ids: string; start: number }[];
      const sentences = rows.map((r) => ({ ids: JSON.parse(r.sentence_ids) as string[], start: r.start }));
      const vectorOf = db.prepare('SELECT vector FROM embeddings WHERE embedding_key = ?');
      const units: DatasetVideo['units'] = [];
      let previous = new Set<string>();
      for (const c of chunks.filter((x) => x.document_id === documentId)) {
        const row = vectorOf.get(c.embedding_key) as { vector: Uint8Array } | undefined;
        if (!row) continue;
        const vector = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
        if (vector.length !== generation.dims) continue;
        const ids = new Set(JSON.parse(c.sentence_ids) as string[]);
        const fresh = sentences.find((s) => s.ids.some((id) => ids.has(id) && !previous.has(id)));
        units.push({ start: fresh?.start ?? c.start, end: c.end, vector: Array.from(vector) });
        previous = ids;
      }
      if (units.length >= 3) videos.push({ videoId, units, truth: [...times].sort((a, b) => a - b) });
    }
    return { schema: 'baocut.chapter-eval/1', videos };
  } finally {
    db.close();
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const command = process.argv[2];
  if (command === 'export') {
    const home = arg('home');
    const truthFile = arg('truth');
    const out = arg('out');
    if (!home || !truthFile || !out) throw new Error('export needs --home, --truth and --out');
    const dataset = exportDataset(home, JSON.parse(fs.readFileSync(truthFile, 'utf8')) as Record<string, number[]>);
    fs.writeFileSync(out, JSON.stringify(dataset));
    console.log(JSON.stringify({ videos: dataset.videos.length, units: dataset.videos.reduce((n, v) => n + v.units.length, 0) }));
    return;
  }
  if (command === 'score') {
    const file = arg('dataset');
    if (!file) throw new Error('score needs --dataset');
    const tolerance = Number(arg('tolerance') ?? 15);
    const dataset = JSON.parse(fs.readFileSync(file, 'utf8')) as Dataset;
    const rows = score(dataset, tolerance);
    const report = {
      videos: dataset.videos.length,
      boundaries: dataset.videos.reduce((n, v) => n + v.truth.length, 0),
      tolerance,
      best: rows[0] ?? null,
      top: rows.slice(0, 10),
    };
    const text = JSON.stringify(report, null, 2);
    const out = arg('out');
    if (out) fs.writeFileSync(out, text);
    console.log(text);
    return;
  }
  throw new Error('usage: chapter-boundaries-eval.ts export|score …');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
