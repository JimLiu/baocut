import { describe, expect, it } from 'vitest';
import { rulerTicks, spanIndex, spansIn, type Span } from './timeline-window.ts';

interface Item extends Span {
  id: string;
}

const item = (id: string, start: number, end: number): Item => ({ id, start, end });
const ids = (items: readonly Item[]) => items.map((i) => i.id);
const index = (items: Item[]) => spanIndex(items, (i) => i);

/** 不用索引、逐件比：与窗相交（贴边算）就留下，按原来的次序。 */
const brute = (items: Item[], from: number, to: number) => items.filter((i) => i.start <= to && i.end >= from);

describe('spansIn', () => {
  it('首尾相接的一长串只取窗里的几件', () => {
    const items = Array.from({ length: 1000 }, (_, k) => item(`c${k}`, k * 10, k * 10 + 10));
    expect(ids(spansIn(index(items), 205, 231))).toEqual(['c20', 'c21', 'c22', 'c23']);
  });

  it('起点在窗口左外、伸进窗口的长片段不漏', () => {
    const items = [item('long', 0, 1000), ...Array.from({ length: 100 }, (_, k) => item(`s${k}`, k * 10, k * 10 + 5))];
    expect(ids(spansIn(index(items), 600, 612))).toEqual(['long', 's60', 's61']);
  });

  it('贴边算相交；整个在窗外的不算', () => {
    const items = [item('a', 0, 10), item('b', 10, 20), item('c', 21, 30)];
    expect(ids(spansIn(index(items), 20, 20.5))).toEqual(['b']);
    expect(ids(spansIn(index(items), 31, 40))).toEqual([]);
    expect(ids(spansIn(index(items), -10, -1))).toEqual([]);
  });

  it('结果按原来的次序（重叠的件靠 DOM 次序决定上下）', () => {
    const items = [item('late', 50, 60), item('early', 0, 100), item('mid', 40, 55)];
    expect(ids(spansIn(index(items), 45, 52))).toEqual(['late', 'early', 'mid']);
  });

  it('extra 里的件不管在不在窗里都带上，去重；不在这条轨上的不带', () => {
    const items = Array.from({ length: 100 }, (_, k) => item(`c${k}`, k, k + 1));
    const stranger = item('other', 0, 1);
    const got = spansIn(index(items), 50.5, 51.5, [items[90]!, items[51]!, stranger]);
    expect(ids(got)).toEqual(['c50', 'c51', 'c90']);
  });

  it('空轨与零长度的件', () => {
    expect(spansIn(index([]), 0, 100)).toEqual([]);
    expect(ids(spansIn(index([item('dot', 5, 5)]), 5, 6))).toEqual(['dot']);
  });

  it('乱序、重叠的随机数据与逐件比一致', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const items = Array.from({ length: 400 }, (_, k) => {
      const start = rand() * 1000;
      return item(`r${k}`, start, start + (rand() < 0.05 ? rand() * 600 : rand() * 8));
    });
    const built = index(items);
    for (let n = 0; n < 200; n++) {
      const from = rand() * 1100 - 50;
      const to = from + rand() * 120;
      expect(ids(spansIn(built, from, to))).toEqual(ids(brute(items, from, to)));
    }
  });
});

describe('rulerTicks', () => {
  const full = (minor: number, major: number, end: number) => rulerTicks({ minor, major, from: 0, to: end, end, limit: 1e6 });

  it('窗里的刻度是整条尺的一段，秒数与主次一格不差', () => {
    for (const [minor, major] of [
      [0.05, 0.1],
      [0.2, 1],
      [2, 10],
      [20, 120],
    ] as const) {
      const all = full(minor, major, 2700);
      const part = rulerTicks({ minor, major, from: 1234.5, to: 1300, end: 2700 });
      const at = all.findIndex((t) => t.seconds === part[0]!.seconds);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(all.slice(at, at + part.length)).toEqual(part);
      expect(part[0]!.seconds).toBeLessThanOrEqual(1234.5);
      expect(part.at(-1)!.seconds).toBeLessThanOrEqual(1300);
    }
  });

  it('不超过片尾，不早于 0；最多 limit 格', () => {
    expect(rulerTicks({ minor: 1, major: 5, from: -30, to: 3, end: 100 }).map((t) => t.seconds)).toEqual([0, 1, 2, 3]);
    expect(rulerTicks({ minor: 1, major: 5, from: 98, to: 200, end: 100 }).map((t) => t.seconds)).toEqual([98, 99, 100]);
    expect(rulerTicks({ minor: 1, major: 5, from: 0, to: 1e6, end: 1e6, limit: 10 })).toHaveLength(10);
    expect(rulerTicks({ minor: 0, major: 5, from: 0, to: 10, end: 10 })).toEqual([]);
  });
});
