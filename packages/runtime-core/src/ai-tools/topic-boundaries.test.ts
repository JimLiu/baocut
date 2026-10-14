import { describe, expect, it } from 'vitest';
import type { ContextWord } from './ai-tool-prompt.ts';
import { topicBoundaries } from './topic-boundaries.ts';

/** 六段讲话，每段 60 秒：前三段讲 alpha，后三段讲 beta，转折在 180 秒。 */
function words(): ContextWord[] {
  const topics = ['alpha', 'alpha', 'alpha', 'beta', 'beta', 'beta'];
  return topics.flatMap((topic, i) => [
    { id: `p${i}a`, text: topic, paragraphStart: true, start: i * 60, end: i * 60 + 30 },
    { id: `p${i}b`, text: `talk${i}.`, paragraphStart: false, start: i * 60 + 30, end: i * 60 + 59 },
  ]);
}

const embed = async (texts: string[]) => texts.map((text) => Float32Array.from(text.startsWith('alpha') ? [1, 0] : [0, 1]));
const input = { videoId: 'v1', documentId: 'd1', words: words() };

describe('话题转折的画面佐证', () => {
  it('这一版有画面索引时，候选带转折前后画面的差异；画面换了的大，没换的接近 0', async () => {
    const frame = (at: number, scene: number[]) => ({ at, vector: Float32Array.from(scene) });
    const changed = Array.from({ length: 45 }, (_, i) => frame(i * 8 + 4, i * 8 + 4 < 180 ? [1, 0, 0] : [0, 1, 0]));
    const result = await topicBoundaries({ embed, timelineFrames: async () => changed }, input, new AbortController().signal);
    expect(result.mode).toBe('topic');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ at: 180 });
    expect(result.candidates[0]!.visualShift).toBeCloseTo(1, 5);

    const same = Array.from({ length: 45 }, (_, i) => frame(i * 8 + 4, [1, 0, 0]));
    const still = await topicBoundaries({ embed, timelineFrames: async () => same }, input, new AbortController().signal);
    expect(still.candidates[0]!.visualShift).toBeCloseTo(0, 5);
  });

  it('没有画面索引、一侧没有帧或取帧出错时不带这一项，候选照旧', async () => {
    const signal = new AbortController().signal;
    const none = await topicBoundaries({ embed, timelineFrames: async () => null }, input, signal);
    expect(none.candidates[0]).not.toHaveProperty('visualShift');
    const oneSide = await topicBoundaries({ embed, timelineFrames: async () => [{ at: 100, vector: Float32Array.from([1, 0]) }] }, input, signal);
    expect(oneSide.candidates[0]).not.toHaveProperty('visualShift');
    const failing = await topicBoundaries({ embed, timelineFrames: () => Promise.reject(new Error('boom')) }, input, signal);
    expect(failing.candidates).toEqual(none.candidates);
  });
});
