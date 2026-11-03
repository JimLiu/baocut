import { describe, expect, it } from 'vitest';
import type { FrameScore } from '../media-analysis.ts';
import { ADAPTIVE_MIN_SCORE, adaptiveCuts, fadeCuts } from './shot-detectors.ts';

const frames = (scores: number[], luma: (i: number) => number = () => 0.5): FrameScore[] =>
  scores.map((score, i) => ({ at: i / 10, score, luma: luma(i) }));

describe('镜头判据：adaptive', () => {
  it('静止画面上的一处突变是切换', () => {
    expect(adaptiveCuts(frames([0, 0.001, 0.001, 0.6, 0.001, 0.001, 0]))).toEqual([{ at: 0.3, score: 0.6 }]);
  });

  it('持续的高分（手持晃动）不算，其中明显更高的那一帧才算', () => {
    const shaky = [0.2, 0.22, 0.18, 0.21, 0.19, 0.9, 0.2, 0.21, 0.19, 0.2];
    expect(adaptiveCuts(frames(shaky)).map((cut) => cut.at)).toEqual([0.5]);
    expect(adaptiveCuts(frames(shaky.filter((v) => v !== 0.9)))).toEqual([]);
  });

  it('固定阈值会把晃动全报出来，adaptive 不会', () => {
    const shaky = Array.from({ length: 40 }, (_, i) => 0.35 + (i % 3) * 0.02);
    expect(frames(shaky).filter((f) => f.score > 0.3)).toHaveLength(40);
    expect(adaptiveCuts(frames(shaky))).toEqual([]);
  });

  it('分数太低的噪声不算，比值再大也不算', () => {
    expect(adaptiveCuts(frames([0, 0, ADAPTIVE_MIN_SCORE / 2, 0, 0]))).toEqual([]);
  });

  it('前后都是 0 时算切换（比值无穷大）', () => {
    expect(adaptiveCuts(frames([0, 0, 0.5, 0, 0]))).toEqual([{ at: 0.2, score: 0.5 }]);
  });
});

describe('镜头判据：fade', () => {
  it('淡出淡入：切点在两次穿越的中点', () => {
    const luma = [0.5, 0.5, 0.01, 0.01, 0.01, 0.5, 0.5];
    expect(fadeCuts(frames(luma.map(() => 0), (i) => luma[i]!))).toEqual([{ at: (0.2 + 0.5) / 2, score: 1 }]);
  });

  it('开头的黑场不算', () => {
    const luma = [0.01, 0.01, 0.5, 0.5];
    expect(fadeCuts(frames(luma.map(() => 0), (i) => luma[i]!))).toEqual([]);
  });

  it('结尾淡出之后不再回来：没有新镜头，不算', () => {
    const luma = [0.5, 0.5, 0.01, 0.01];
    expect(fadeCuts(frames(luma.map(() => 0), (i) => luma[i]!))).toEqual([]);
  });

  it('门限可调', () => {
    const luma = [0.5, 0.1, 0.5];
    expect(fadeCuts(frames(luma.map(() => 0), (i) => luma[i]!))).toEqual([]);
    expect(fadeCuts(frames(luma.map(() => 0), (i) => luma[i]!), 0.2)).toHaveLength(1);
  });
});
