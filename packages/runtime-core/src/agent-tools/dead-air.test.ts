import { describe, expect, it } from 'vitest';
import { audioActivity, combineActivity, deadRanges, motionActivity, motionRatio } from './dead-air.ts';

/** tick = 0.1 秒，算起来方便。 */
const TICK = 0.1;
const none = { margin: 0, minCut: 0, minKeep: 0 };
const seconds = (ranges: { from: number; to: number }[]) => ranges.map((r) => [Number(r.from.toFixed(3)), Number(r.to.toFixed(3))]);
const pattern = (text: string) => Uint8Array.from([...text].map((c) => (c === '#' ? 1 : 0)));

describe('没声音的段落', () => {
  it('每片按整段峰值的比例判断', () => {
    const pcm = new Float32Array(400);
    pcm.fill(0.5, 0, 100);
    pcm.fill(0.01, 100, 200);
    pcm.fill(0.03, 200, 300);
    expect([...audioActivity(pcm, 1000, 0.04, 0.1)]).toEqual([1, 0, 1, 0]);
  });

  it('全静音时全部没有内容，不除以 0', () => {
    expect([...audioActivity(new Float32Array(200), 1000, 0.04, 0.1)]).toEqual([0, 0]);
  });
});

describe('没动静的段落', () => {
  it('压缩噪声不算变化', () => {
    const a = new Uint8Array(100).fill(100);
    expect(motionRatio(a, new Uint8Array(100).fill(104))).toBe(0);
    const b = new Uint8Array(100).fill(100);
    b.fill(200, 0, 25);
    expect(motionRatio(a, b)).toBe(0.25);
  });

  it('按帧率换成时间片', () => {
    expect([...motionActivity([0, 0.5, 0, 0.5], 10, 0.02, 4, 0.1)]).toEqual([0, 1, 0, 1]);
    expect([...motionActivity([0.5], 10, 0.02, 3, 0.1)]).toEqual([1, 1, 1]);
  });

  it('两种判据任一有内容就算有', () => {
    expect([...combineActivity(pattern('#..'), pattern('.#..'))]).toEqual([1, 1, 0, 0]);
  });
});

describe('区间', () => {
  it('中间与首尾的空档都给出来', () => {
    expect(seconds(deadRanges(pattern('..##..##..'), none, TICK))).toEqual([
      [0, 0.2],
      [0.4, 0.6],
      [0.8, 1],
    ]);
  });

  it('margin 向两边留余量，留到相接时空档消失', () => {
    expect(seconds(deadRanges(pattern('....##....'), { ...none, margin: 0.1 }, TICK))).toEqual([
      [0, 0.3],
      [0.7, 1],
    ]);
    expect(deadRanges(pattern('##..##'), { ...none, margin: 0.1 }, TICK)).toEqual([]);
  });

  it('短于 minCut 的气口留下；首尾的空档不论多短都给', () => {
    expect(seconds(deadRanges(pattern('.##..##.'), { ...none, minCut: 0.3 }, TICK))).toEqual([
      [0, 0.1],
      [0.7, 0.8],
    ]);
  });

  it('短于 minKeep 的响动算噪声', () => {
    expect(seconds(deadRanges(pattern('...#...'), { ...none, minKeep: 0.2 }, TICK))).toEqual([[0, 0.7]]);
    expect(seconds(deadRanges(pattern('...##..'), { ...none, minKeep: 0.2 }, TICK))).toEqual([
      [0, 0.3],
      [0.5, 0.7],
    ]);
  });

  it('全是内容时没有区间；全没有内容时整段', () => {
    expect(deadRanges(pattern('####'), none, TICK)).toEqual([]);
    expect(seconds(deadRanges(pattern('....'), none, TICK))).toEqual([[0, 0.4]]);
  });
});
