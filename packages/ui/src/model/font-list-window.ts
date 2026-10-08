/**
 * 选字框的虚拟列表（原型 panel-font-picker.jsx 的 .flist；全部字体约两千行）：分段摊平成定高的条目，按滚动位置只画
 * 视野里的那几十条。几何与原型一致：段头 26px，一行 33px，列表最高 240px。
 */

export const FONT_HEAD_HEIGHT = 26;
export const FONT_ROW_HEIGHT = 33;
export const FONT_LIST_HEIGHT = 240;

export type FontListItem<T> =
  | { kind: 'head'; key: string; section: string; title: string; top: number }
  | { kind: 'row'; key: string; section: string; row: T; top: number };

export interface FontListLayout<T> {
  items: FontListItem<T>[];
  height: number;
}

/** 分段摊平：每段一个段头接它的行；空段不出现。 */
export function fontListLayout<T extends { family: string }>(
  sections: readonly { key: string; title: string; rows: readonly T[] }[],
): FontListLayout<T> {
  const items: FontListItem<T>[] = [];
  let top = 0;
  for (const s of sections) {
    if (!s.rows.length) continue;
    items.push({ kind: 'head', key: `head:${s.key}`, section: s.key, title: s.title, top });
    top += FONT_HEAD_HEIGHT;
    for (const row of s.rows) {
      items.push({ kind: 'row', key: `${s.key}:${row.family}`, section: s.key, row, top });
      top += FONT_ROW_HEIGHT;
    }
  }
  return { items, height: top };
}

const itemHeight = (item: FontListItem<unknown>) => (item.kind === 'head' ? FONT_HEAD_HEIGHT : FONT_ROW_HEIGHT);

/** 视野里的条目（前后各多画 `overscan` 条）：按 `top` 二分找第一条，返回 [start, end)。 */
export function visibleRange(items: readonly FontListItem<unknown>[], scrollTop: number, viewport: number, overscan = 6): [number, number] {
  if (!items.length) return [0, 0];
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (items[mid]!.top <= scrollTop) lo = mid;
    else hi = mid - 1;
  }
  let end = lo;
  while (end < items.length && items[end]!.top < scrollTop + viewport) end++;
  return [Math.max(0, lo - overscan), Math.min(items.length, end + overscan)];
}

/** 视野里（不含前后多画的）要取样张的族：只有行，去重，跳过已经有样张状态的。 */
export function samplesToLoad<T extends { family: string }>(
  items: readonly FontListItem<T>[],
  scrollTop: number,
  viewport: number,
  known: (family: string) => boolean,
): string[] {
  const [start, end] = visibleRange(items, scrollTop, viewport, 0);
  const out = new Set<string>();
  for (let i = start; i < end; i++) {
    const item = items[i]!;
    if (item.kind === 'row' && !known(item.row.family)) out.add(item.row.family);
  }
  return [...out];
}

/** 打开时把当前选中的那一行滚进视野（第一屏里就不滚），尽量放在中间。 */
export function scrollToRow<T extends { family: string }>(items: readonly FontListItem<T>[], family: string, viewport: number): number {
  const key = family.trim().toLowerCase();
  const hit = items.find((i) => i.kind === 'row' && i.row.family.trim().toLowerCase() === key);
  if (!hit || hit.top + itemHeight(hit) <= viewport) return 0;
  return Math.max(0, hit.top - (viewport - FONT_ROW_HEIGHT) / 2);
}
