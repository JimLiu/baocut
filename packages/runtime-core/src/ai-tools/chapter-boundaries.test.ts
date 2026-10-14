import { describe, expect, it } from 'vitest';
import { chapterBoundaryCandidates, type BoundaryChunk } from './chapter-boundaries.ts';

/** 二维单位向量：角度相近的句群话题相近。 */
function chunk(start: number, angle: number, length = 30): BoundaryChunk {
  return { start, end: start + length, vector: Float32Array.from([Math.cos(angle), Math.sin(angle)]) };
}

/** 固定的抖动：同一话题里相邻句群的角度差在 0.15 弧度以内。 */
const JITTER = [0, 0.08, -0.05, 0.1, -0.02, 0.06, -0.07, 0.03];

/** 三个话题（6、8、4 个 30 秒的句群），话题之间跳 1.2 弧度：转折在 180 秒与 420 秒，时间线到 540 秒。 */
function threeTopics(): BoundaryChunk[] {
  const out: BoundaryChunk[] = [];
  let t = 0;
  for (const [index, size] of [6, 8, 4].entries()) {
    for (let i = 0; i < size; i++) {
      out.push(chunk(t, index * 1.2 + JITTER[i % JITTER.length]!));
      t += 30;
    }
  }
  return out;
}

describe('章节边界候选（§3.6）', () => {
  it('话题转折处是候选、深度最大：时间是后一个句群的起点；同一组向量结果不变', () => {
    const chunks = threeTopics();
    const result = chapterBoundaryCandidates(chunks);
    const at = result.candidates.map((c) => c.at);
    expect(at).toEqual(expect.arrayContaining([180, 420]));
    const top = [...result.candidates].sort((a, b) => b.depth - a.depth).slice(0, 2);
    expect(top.map((c) => c.at).sort((a, b) => a - b)).toEqual([180, 420]);
    expect(result.candidates.every((c) => c.after === c.before + 1 && c.depth > result.threshold && c.drift > 0)).toBe(true);
    expect(chapterBoundaryCandidates(chunks)).toEqual(result);
    // 章数有上限时留漂移大的。
    expect(chapterBoundaryCandidates(chunks, { maxChapters: 3 }).candidates.map((c) => c.at)).toEqual([180, 420]);
  });

  it('离首尾或另一个边界不足最短章节长度的不要', () => {
    // 最后一个话题只有 120 秒：最短 150 秒时 420 秒的转折离结尾太近。
    expect(chapterBoundaryCandidates(threeTopics(), { minChapterSec: 150, maxChapters: 3 }).candidates.map((c) => c.at)).toEqual([180]);
    const result = chapterBoundaryCandidates(threeTopics(), { minChapterSec: 100 });
    const at = result.candidates.map((c) => c.at);
    expect(at.every((x, i) => i === 0 || x - at[i - 1]! >= 100)).toBe(true);
  });

  it('两侧取窗口：一句插话的深度远小于真正的转折（只比相邻两个时两者差不多）', () => {
    // 第一个话题 10 个句群，第 5 个（120 秒）是一句离题插话；第二个话题从 300 秒开始。
    const chunks: BoundaryChunk[] = [];
    let t = 0;
    for (let i = 0; i < 10; i++, t += 30) chunks.push(chunk(t, i === 4 ? 1.0 : JITTER[i % JITTER.length]!));
    for (let i = 0; i < 8; i++, t += 30) chunks.push(chunk(t, 1.2 + JITTER[i % JITTER.length]!));
    const depthAt = (window: number, at: number) => chapterBoundaryCandidates(chunks, { window }).candidates.find((c) => c.at === at)?.depth ?? 0;
    const real = (window: number) => depthAt(window, 300);
    const aside = (window: number) => Math.max(depthAt(window, 120), depthAt(window, 150));
    expect(aside(1)).toBeGreaterThan(real(1) / 2);
    expect(aside(2)).toBeLessThan(real(2) / 4);
    const top = [...chapterBoundaryCandidates(chunks).candidates].sort((a, b) => b.depth - a.depth)[0]!;
    expect(top.at).toBe(300);
  });

  it('没有转折（漂移都一样）或句群太少时没有候选', () => {
    const flat = Array.from({ length: 10 }, (_, i) => chunk(i * 30, i * 0.1));
    expect(chapterBoundaryCandidates(flat).candidates).toEqual([]);
    expect(chapterBoundaryCandidates([]).candidates).toEqual([]);
    expect(chapterBoundaryCandidates([chunk(0, 0)]).candidates).toEqual([]);
  });
});
