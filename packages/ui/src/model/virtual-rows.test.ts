import { describe, expect, it } from 'vitest';
import {
  alignedScrollTop,
  anchorShift,
  estimateLines,
  layoutRows,
  rowAt,
  rowCount,
  rowRange,
  rowSegments,
  type RowSegment,
} from './virtual-rows.ts';

const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
const NONE = new Map<string, number>();
/** 每行 50px 估计、外加量过的几行。 */
const layoutOf = (n: number, measured: Record<string, number> = {}) => layoutRows(keys(n), new Map(Object.entries(measured)), () => 50);
const gaps = (segments: RowSegment[]) => segments.flatMap((s) => ('gap' in s ? [s.gap] : []));
const rows = (segments: RowSegment[]) => segments.flatMap((s) => ('index' in s ? [s.index] : []));

describe('不定高的虚拟列表：排版', () => {
  it('量过的用量到的高，没量过的按估计；offsets 比行数多一个，末尾是总高', () => {
    const layout = layoutRows(keys(4), new Map([['k1', 80]]), (i) => 40 + i);
    expect([...layout.offsets]).toEqual([0, 40, 120, 162, 205]);
    expect(layout.total).toBe(205);
    expect(rowCount(layout)).toBe(4);
  });

  it('空列表与单行', () => {
    const empty = layoutRows([], NONE, () => 50);
    expect(empty.total).toBe(0);
    expect(rowAt(empty, 10)).toBe(-1);
    expect(rowRange(empty, 0, 600, 600)).toEqual([0, 0]);
    expect(rowSegments(empty, [0, 0], [3])).toEqual([]);
    expect(alignedScrollTop(empty, 0, 600, 0, 'center')).toBe(0);
    const one = layoutOf(1);
    expect(rowRange(one, 0, 600, 600)).toEqual([0, 1]);
    expect(rowSegments(one, [0, 1], [0])).toEqual([{ index: 0 }]);
    expect(alignedScrollTop(one, 0, 600, 0, 'end')).toBe(0);
  });

  it('按 y 二分找行：上沿算这一行，越界夹到两头', () => {
    const layout = layoutOf(1000);
    expect(rowAt(layout, 0)).toBe(0);
    expect(rowAt(layout, 49.9)).toBe(0);
    expect(rowAt(layout, 50)).toBe(1);
    expect(rowAt(layout, 25_010)).toBe(500);
    expect(rowAt(layout, -5)).toBe(0);
    expect(rowAt(layout, 1e9)).toBe(999);
  });

  it('窗口是与视口加前后余量相交的行；只挂几十行', () => {
    const layout = layoutOf(5000);
    expect(rowRange(layout, 0, 600, 0)).toEqual([0, 12]);
    // 上沿正好在一行的下沿：那一行不算。
    expect(rowRange(layout, 100, 600, 0)).toEqual([2, 14]);
    expect(rowRange(layout, 125, 600, 0)).toEqual([2, 15]);
    const [start, end] = rowRange(layout, 100_000, 600, 600);
    expect(start).toBe((100_000 - 600) / 50);
    expect(end).toBe((100_000 + 1200) / 50);
    expect(end - start).toBe(36);
    // 滚过头也至少有一行。
    expect(rowRange(layout, 1e9, 600, 0)).toEqual([4999, 5000]);
  });
});

describe('不定高的虚拟列表：段', () => {
  it('窗口之外没有钉住的行：前后各一段空白', () => {
    const layout = layoutOf(100);
    const segments = rowSegments(layout, [10, 13], []);
    expect(segments).toEqual([{ gap: 500 }, { index: 10 }, { index: 11 }, { index: 12 }, { gap: 87 * 50 }]);
  });

  it('钉住的行在窗口外：按下标插进去，前后的空白拆开；在窗口内的不重复', () => {
    const layout = layoutOf(100, { k3: 120 });
    const segments = rowSegments(layout, [50, 52], [3, 51, 90, 3]);
    expect(rows(segments)).toEqual([3, 50, 51, 90]);
    expect(segments[0]).toEqual({ gap: 150 });
    expect(segments[1]).toEqual({ index: 3 });
    expect(segments[2]).toEqual({ gap: layout.offsets[50]! - layout.offsets[4]! });
  });

  it('钉住的行与窗口相邻、彼此相邻：中间没有空白段；越界的钉子不算', () => {
    const layout = layoutOf(100);
    const segments = rowSegments(layout, [20, 22], [19, 22, 23, 60, 61, -1, 100, 1.5]);
    expect(rows(segments)).toEqual([19, 20, 21, 22, 23, 60, 61]);
    expect(segments).toEqual([
      { gap: 19 * 50 },
      { index: 19 },
      { index: 20 },
      { index: 21 },
      { index: 22 },
      { index: 23 },
      { gap: 36 * 50 },
      { index: 60 },
      { index: 61 },
      { gap: 38 * 50 },
    ]);
  });

  it('钉在第一行、最后一行：没有零高的空白段', () => {
    const layout = layoutOf(10);
    const segments = rowSegments(layout, [4, 6], [0, 9]);
    expect(segments).toEqual([{ index: 0 }, { gap: 150 }, { index: 4 }, { index: 5 }, { gap: 150 }, { index: 9 }]);
  });

  it('空白段的高度加上挂着的行高，总是等于总高', () => {
    const measured: Record<string, number> = {};
    for (let i = 0; i < 300; i += 7) measured[`k${i}`] = 30 + ((i * 13) % 90);
    const layout = layoutRows(keys(300), new Map(Object.entries(measured)), (i) => 40 + (i % 5) * 11.2);
    for (const [range, pinned] of [
      [[0, 0], []],
      [[0, 300], []],
      [
        [120, 140],
        [3, 4, 299, 141, 119],
      ],
      [
        [290, 300],
        [0, 150],
      ],
    ] as const) {
      const segments = rowSegments(layout, range, pinned);
      const mounted = rows(segments).reduce((sum, i) => sum + layout.offsets[i + 1]! - layout.offsets[i]!, 0);
      const blank = gaps(segments).reduce((a, b) => a + b, 0);
      expect(mounted + blank).toBeCloseTo(layout.total, 6);
    }
  });
});

describe('不定高的虚拟列表：对齐', () => {
  const layout = layoutRows(keys(100), new Map([['k40', 900]]), () => 50);
  const viewport = 600;

  it('start、end、center', () => {
    expect(alignedScrollTop(layout, 20, viewport, 0, 'start')).toBe(1000);
    expect(alignedScrollTop(layout, 20, viewport, 0, 'end')).toBe(1050 - 600);
    expect(alignedScrollTop(layout, 20, viewport, 0, 'center')).toBe(1000 - 275);
  });

  it('nearest：整行可见不动，在上面贴顶，在下面贴底，比视口高的贴顶', () => {
    expect(alignedScrollTop(layout, 20, viewport, 800, 'nearest')).toBe(800);
    expect(alignedScrollTop(layout, 20, viewport, 1010, 'nearest')).toBe(1000);
    expect(alignedScrollTop(layout, 20, viewport, 300, 'nearest')).toBe(1050 - 600);
    expect(alignedScrollTop(layout, 40, viewport, 0, 'nearest')).toBe(2000);
    expect(alignedScrollTop(layout, 40, viewport, 2100, 'nearest')).toBe(2000);
  });

  it('夹在 [0, total − viewport]', () => {
    expect(alignedScrollTop(layout, 0, viewport, 500, 'center')).toBe(0);
    expect(alignedScrollTop(layout, 99, viewport, 0, 'start')).toBe(layout.total - viewport);
    expect(alignedScrollTop(layout, 500, viewport, 0, 'start')).toBe(layout.total - viewport);
    expect(alignedScrollTop(layoutOf(3), 2, viewport, 0, 'end')).toBe(0);
  });
});

describe('不定高的虚拟列表：锚点补偿', () => {
  it('只补锚点上方的变化', () => {
    const before = layoutOf(100);
    const after = layoutOf(100, { k5: 80, k30: 20, k60: 200 });
    // 锚点是第 50 行：上面第 5 行 +30、第 30 行 −30，抵消。
    expect(anchorShift(before, after, 50)).toBe(0);
    expect(anchorShift(before, after, 10)).toBe(30);
    expect(anchorShift(before, after, 31)).toBe(0);
    // 锚点自己与下面的行变高：不补。
    expect(anchorShift(before, after, 60)).toBe(0);
    expect(anchorShift(before, after, 5)).toBe(0);
    expect(anchorShift(before, after, 6)).toBe(30);
  });

  it('滚在顶上（锚点第 0 行）与空列表：不补', () => {
    const before = layoutOf(10);
    const after = layoutOf(10, { k0: 300 });
    expect(anchorShift(before, after, 0)).toBe(0);
    expect(anchorShift(layoutOf(0), layoutOf(0), 3)).toBe(0);
  });

  it('补完之后锚点行在视口里的位置不变', () => {
    const before = layoutOf(200);
    const scrollTop = 4321;
    const anchor = rowAt(before, scrollTop);
    const within = scrollTop - before.offsets[anchor]!;
    const after = layoutOf(200, { k3: 75.5, k10: 12.25, k90: 77, k150: 10 });
    const next = scrollTop + anchorShift(before, after, anchor);
    expect(next - after.offsets[anchor]!).toBeCloseTo(within, 9);
  });
});

describe('行数粗估', () => {
  it('拉丁按半个字宽、CJK 按一个字宽，显式换行各起一行', () => {
    expect(estimateLines('', 300, 14)).toBe(1);
    // 300px / 14px ≈ 21.4em：42 个拉丁字一行，43 个折两行。
    expect(estimateLines('a'.repeat(42), 300, 14)).toBe(1);
    expect(estimateLines('a'.repeat(43), 300, 14)).toBe(2);
    expect(estimateLines('字'.repeat(21), 300, 14)).toBe(1);
    expect(estimateLines('字'.repeat(22), 300, 14)).toBe(2);
    expect(estimateLines('한'.repeat(22), 300, 14)).toBe(2);
    expect(estimateLines('一\n二\n\n三', 300, 14)).toBe(4);
    expect(estimateLines('😀'.repeat(22), 300, 14)).toBe(2);
    expect(estimateLines('anything', 0, 14)).toBe(1);
  });
});
