import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SEMANTIC_STORE_DIR, SemanticStore } from '../packages/runtime-core/src/space/semantic/store.ts';
import { exportDataset, matched, score, type Dataset } from './embedding-eval/chapter-boundaries-eval.ts';

/** 二维单位向量：角度相近的句群话题相近。 */
const unit = (start: number, angle: number) => ({ start, end: start + 30, vector: [Math.cos(angle), Math.sin(angle)] });
const JITTER = [0, 0.08, -0.05, 0.1, -0.02, 0.06, -0.07, 0.03];

/** 几个话题，每个话题若干个 30 秒的句群，话题之间跳 1.2 弧度；作者章节在每个话题开头。 */
function video(videoId: string, sizes: number[]): Dataset['videos'][number] {
  const units = [];
  const truth = [];
  let t = 0;
  for (const [index, size] of sizes.entries()) {
    truth.push(t);
    for (let i = 0; i < size; i++, t += 30) units.push(unit(t, index * 1.2 + JITTER[i % JITTER.length]!));
  }
  return { videoId, units, truth };
}

let dir: string | null = null;
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = null;
});

describe('章节边界校准脚本', () => {
  it('配对是一一的、在容差内', () => {
    expect(matched([100, 104, 300], [102, 290], 15)).toBe(2);
    expect(matched([100], [130], 15)).toBe(0);
  });

  it('评分：转折清楚的合成数据上最好的一组参数全中；第一章的起点不算边界', () => {
    const dataset: Dataset = { schema: 'baocut.chapter-eval/1', videos: [video('a', [6, 8, 4]), video('b', [5, 5, 7, 6])] };
    const rows = score(dataset, 15);
    expect(rows[0]).toMatchObject({ precision: 1, recall: 1, f1: 1 });
    expect(rows.every((r) => r.f1 <= rows[0]!.f1)).toBe(true);
    expect(rows.length).toBe(6 * 4 * 4);
  });

  it('导出：只读打开语义索引，取当前世代的讲话句群与向量，起点跳过重叠的句子，不带文字', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-chapter-eval-'));
    const store = new SemanticStore(path.join(dir, 'cache', SEMANTIC_STORE_DIR));
    const sentences = Array.from({ length: 6 }, (_, i) => ({
      documentId: 'd1',
      documentKind: 'speech' as const,
      ord: i,
      sentenceIds: [`s${i}`],
      text: `sentence ${i}`,
      clock: 'sequence' as const,
      start: i * 10,
      end: i * 10 + 10,
      speaker: null,
    }));
    // 三个句群，相邻重叠一句：[s0 s1] [s1 s2 s3] [s3 s4 s5]。
    const groups = [[0, 1], [1, 2, 3], [3, 4, 5]];
    const chunks = groups.map((ids, ord) => ({
      chunkId: `c${ord}`,
      videoId: 'v1',
      documentId: 'd1',
      documentKind: 'speech' as const,
      evidenceType: 'transcript' as const,
      sentenceIds: ids.map((i) => `s${i}`),
      text: ids.map((i) => `sentence ${i}`).join(' '),
      clock: 'sequence' as const,
      start: ids[0]! * 10,
      end: ids.at(-1)! * 10 + 10,
      speaker: null,
      language: 'en',
      chapter: null,
      ord,
      embeddingKey: `k${ord}`,
    }));
    store.putEmbeddings(chunks.map((c, i) => ({ key: c.embeddingKey, encoderProfileId: 'p', vector: Float32Array.from([Math.cos(i), Math.sin(i)]) })));
    const { expectedGeneration } = store.freeze('v1', dir, null, 'r1');
    const published = store.publish({ videoId: 'v1', revision: 'r1', expectedGeneration, encoderProfileId: 'p', embeddingSpaceId: 'space', dims: 2, chunks, sentences });
    expect(published.published).toBe(true);
    store.close();

    const dataset = exportDataset(dir, { v1: [0, 30], missing: [0] });
    expect(dataset.videos).toHaveLength(1);
    const [v] = dataset.videos;
    expect(v!.units.map((u) => u.start)).toEqual([0, 20, 40]);
    expect(v!.units[1]!.vector[0]).toBeCloseTo(Math.cos(1), 5);
    expect(v!.truth).toEqual([0, 30]);
    expect(JSON.stringify(dataset)).not.toContain('sentence');
  });
});
