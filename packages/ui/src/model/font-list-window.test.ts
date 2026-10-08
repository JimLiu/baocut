import { describe, expect, it } from 'vitest';
import {
  FONT_HEAD_HEIGHT,
  FONT_LIST_HEIGHT,
  FONT_ROW_HEIGHT,
  fontListLayout,
  samplesToLoad,
  scrollToRow,
  visibleRange,
} from './font-list-window.ts';

const rows = (n: number, prefix = 'Family') => Array.from({ length: n }, (_, i) => ({ family: `${prefix} ${i}` }));

describe('选字框的虚拟列表', () => {
  it('分段摊平成定高的条目：段头 26px、一行 33px，空段不出现', () => {
    const layout = fontListLayout([
      { key: 'video', title: '这个视频里用到', rows: rows(2, 'Used') },
      { key: 'recent', title: '最近用过', rows: [] },
      { key: 'all', title: '全部字体', rows: rows(3) },
    ]);
    expect(layout.items.map((i) => [i.kind, i.top])).toEqual([
      ['head', 0],
      ['row', 26],
      ['row', 59],
      ['head', 92],
      ['row', 118],
      ['row', 151],
      ['row', 184],
    ]);
    expect(layout.height).toBe(2 * FONT_HEAD_HEIGHT + 5 * FONT_ROW_HEIGHT);
  });

  it('1944 行只画视野里的几十条，滚到哪画到哪', () => {
    const layout = fontListLayout([{ key: 'all', title: '全部字体', rows: rows(1944) }]);
    const [start, end] = visibleRange(layout.items, 0, FONT_LIST_HEIGHT);
    expect(start).toBe(0);
    expect(end - start).toBeLessThan(20);
    const top = 1000 * FONT_ROW_HEIGHT;
    const [s2, e2] = visibleRange(layout.items, top, FONT_LIST_HEIGHT, 0);
    expect(layout.items[s2]!.top).toBeLessThanOrEqual(top);
    expect(layout.items[e2 - 1]!.top).toBeLessThan(top + FONT_LIST_HEIGHT);
    expect(e2 - s2).toBeLessThanOrEqual(Math.ceil(FONT_LIST_HEIGHT / FONT_ROW_HEIGHT) + 1);
    const [s3, e3] = visibleRange(layout.items, layout.height, FONT_LIST_HEIGHT);
    expect(e3).toBe(layout.items.length);
    expect(s3).toBeGreaterThan(1900);
  });

  it('样张只取视野里还没取过的行（不含段头、不含前后多画的）', () => {
    const layout = fontListLayout([{ key: 'all', title: '全部字体', rows: rows(100) }]);
    const known = new Set(['Family 1']);
    const want = samplesToLoad(layout.items, 0, FONT_LIST_HEIGHT, (f) => known.has(f));
    expect(want[0]).toBe('Family 0');
    expect(want).not.toContain('Family 1');
    expect(want.length).toBeLessThanOrEqual(7);
  });

  it('打开时把选中的那一行滚进视野，第一屏里就不滚', () => {
    const layout = fontListLayout([{ key: 'all', title: '全部字体', rows: rows(500) }]);
    expect(scrollToRow(layout.items, 'Family 2', FONT_LIST_HEIGHT)).toBe(0);
    const top = scrollToRow(layout.items, 'family 300', FONT_LIST_HEIGHT);
    const row = layout.items.find((i) => i.kind === 'row' && i.row.family === 'Family 300')!;
    expect(row.top).toBeGreaterThanOrEqual(top);
    expect(row.top + FONT_ROW_HEIGHT).toBeLessThanOrEqual(top + FONT_LIST_HEIGHT);
    expect(scrollToRow(layout.items, 'Nope', FONT_LIST_HEIGHT)).toBe(0);
  });
});
