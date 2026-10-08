import { describe, expect, it } from 'vitest';
import { MAX_DUB_TEMPO, alignDub, atempoFilter } from './dub-alignment.ts';

describe('alignDub', () => {
  it('不比时间窗长：从原句起点放，不变速', () => {
    const a = alignDub({ start: 2, end: 5, limit: 6 }, 2.5);
    expect(a).toEqual({ fit: 'fit', start: 2, tempo: 1, duration: 2.5, end: 4.5, overflow: 0 });
    // 刚好一样长也不变速。
    expect(alignDub({ start: 2, end: 5, limit: 5 }, 3).fit).toBe('fit');
  });

  it('比时间窗长：按需加速，倍率向上取到千分位', () => {
    const a = alignDub({ start: 0, end: 3, limit: 10 }, 3.3);
    expect(a.fit).toBe('tempo');
    expect(a.tempo).toBe(1.1);
    expect(a.end <= 3 + 1e-9).toBe(true);
    const b = alignDub({ start: 0, end: 3, limit: 10 }, 3.31);
    expect(b.tempo).toBe(1.104);
    expect(b.duration <= 3).toBe(true);
  });

  it('加速到上限刚好放下仍算加速', () => {
    const a = alignDub({ start: 1, end: 3, limit: 3 }, 2.5);
    expect(a.fit).toBe('tempo');
    expect(a.tempo).toBe(MAX_DUB_TEMPO);
    expect(Math.abs(a.end - 3) < 1e-9).toBe(true);
  });

  it('加速到上限仍放不下：占用之后的静音，不越过下一句', () => {
    const a = alignDub({ start: 1, end: 3, limit: 4 }, 3.5);
    expect(a.fit).toBe('extended');
    expect(a.tempo).toBe(MAX_DUB_TEMPO);
    expect(Math.abs(a.duration - 2.8) < 1e-9).toBe(true);
    expect(a.end <= 4).toBe(true);
  });

  it('仍放不下：超长，报告超出多少，不截断', () => {
    const a = alignDub({ start: 1, end: 3, limit: 3.5 }, 5);
    expect(a.fit).toBe('overlong');
    expect(a.tempo).toBe(MAX_DUB_TEMPO);
    expect(Math.abs(a.duration - 4) < 1e-9).toBe(true);
    expect(Math.abs(a.overflow - 1.5) < 1e-9).toBe(true);
  });

  it('下一句的起点早于这句的终点：时间窗只算到下一句', () => {
    const a = alignDub({ start: 0, end: 4, limit: 2 }, 3);
    expect(a.fit).toBe('overlong');
    expect(Math.abs(a.overflow - 0.4) < 1e-9).toBe(true);
    const b = alignDub({ start: 0, end: 4, limit: 2 }, 1.9);
    expect(b.fit).toBe('fit');
  });

  it('零长的时间窗直接看静音', () => {
    expect(alignDub({ start: 2, end: 2, limit: 4 }, 2).fit).toBe('extended');
    expect(alignDub({ start: 2, end: 2, limit: 2 }, 1).fit).toBe('overlong');
  });

  it('同样的输入总是同样的结果；不合法的输入抛错', () => {
    expect(alignDub({ start: 0, end: 1, limit: 2 }, 1.2)).toEqual(alignDub({ start: 0, end: 1, limit: 2 }, 1.2));
    expect(() => alignDub({ start: 0, end: 1, limit: 2 }, 0)).toThrow(RangeError);
    expect(() => alignDub({ start: 2, end: 1, limit: 3 }, 1)).toThrow(RangeError);
    expect(() => alignDub({ start: 0, end: 1, limit: 2 }, 1, 0.9)).toThrow(RangeError);
  });

  it('atempo 的参数', () => {
    expect(atempoFilter(1.1)).toBe('atempo=1.100');
  });
});
