/**
 * 不定高的纵向虚拟列表（上千条的字幕、译文列表）：行高先按估计排、挂上之后按量到的改；只挂视野前后的几十行，外加钉住的行
 * （正在改的、焦点所在的、查找命中的），其余的折成空白段。都是纯函数，React 那一层在 components/editor/use-virtual-rows.ts。
 * 定高的先例是选字框的 font-list-window.ts。
 */

export type Align = 'start' | 'center' | 'end' | 'nearest';

/** `offsets[i]` 是第 i 行的上沿，`offsets[n]` 即 `total`（所以长度是行数 + 1）。 */
export interface RowLayout {
  offsets: Float64Array;
  total: number;
}

/** 一段：空白段给高度（连着几行没挂的），行段给下标。DOM 顺序 = 下标顺序。 */
export type RowSegment = { gap: number } | { index: number };

/** 排一遍：量过的用量到的高，没量过的用估计。 */
export function layoutRows(keys: readonly string[], measured: ReadonlyMap<string, number>, estimate: (index: number) => number): RowLayout {
  const offsets = new Float64Array(keys.length + 1);
  let top = 0;
  for (let i = 0; i < keys.length; i++) {
    offsets[i] = top;
    top += measured.get(keys[i]!) ?? estimate(i);
  }
  offsets[keys.length] = top;
  return { offsets, total: top };
}

export const rowCount = (layout: RowLayout) => layout.offsets.length - 1;
export const rowHeight = (layout: RowLayout, index: number) => layout.offsets[index + 1]! - layout.offsets[index]!;

/** `y` 落在哪一行（二分；上沿算这一行，越界夹到两头）。空列表是 -1。 */
export function rowAt(layout: RowLayout, y: number): number {
  const n = rowCount(layout);
  if (n <= 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout.offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 要挂的行 [start, end)：与 [scrollTop − overscan, scrollTop + viewport + overscan) 相交的行。 */
export function rowRange(layout: RowLayout, scrollTop: number, viewport: number, overscanPx: number): [number, number] {
  const n = rowCount(layout);
  if (n <= 0) return [0, 0];
  const top = Math.max(0, scrollTop - overscanPx);
  const bottom = scrollTop + Math.max(0, viewport) + overscanPx;
  let start = rowAt(layout, top);
  // 上沿正好落在上一行的下沿：那一行已经不相交。
  if (start < n - 1 && layout.offsets[start + 1]! <= top) start++;
  let end = start;
  while (end < n && (end === start || layout.offsets[end]! < bottom)) end++;
  return [start, end];
}

/** 窗口 ∪ 钉住的行 → 按下标排好的段：相邻的行之间没有空白段，空白段的高度之和加上挂着的行高正好是 `total`。 */
export function rowSegments(layout: RowLayout, range: readonly [number, number], pinned: readonly number[]): RowSegment[] {
  const n = rowCount(layout);
  const [start, end] = [Math.max(0, range[0]), Math.min(n, range[1])];
  const outside = [...new Set(pinned)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < n && (i < start || i >= end))
    .sort((a, b) => a - b);
  const indexes: number[] = [];
  let k = 0;
  while (k < outside.length && outside[k]! < start) indexes.push(outside[k++]!);
  for (let i = start; i < end; i++) indexes.push(i);
  while (k < outside.length) indexes.push(outside[k++]!);
  const segments: RowSegment[] = [];
  let at = 0;
  for (const index of indexes) {
    const gap = layout.offsets[index]! - layout.offsets[at]!;
    if (index > at && gap > 0) segments.push({ gap });
    segments.push({ index });
    at = index + 1;
  }
  const tail = layout.total - layout.offsets[Math.min(at, n)]!;
  if (at < n && tail > 0) segments.push({ gap: tail });
  return segments;
}

/**
 * 把第 `index` 行对到视口里的 scrollTop：`start` 上沿贴顶，`end` 下沿贴底，`center` 居中，`nearest` 已经整行可见就不动、
 * 在上面就贴顶、在下面就贴底（比视口还高的贴顶）。结果夹在 [0, total − viewport]。
 */
export function alignedScrollTop(layout: RowLayout, index: number, viewport: number, scrollTop: number, align: Align): number {
  const n = rowCount(layout);
  if (n <= 0) return 0;
  const i = Math.min(Math.max(0, index), n - 1);
  const top = layout.offsets[i]!;
  const height = rowHeight(layout, i);
  let target: number;
  if (align === 'start') target = top;
  else if (align === 'end') target = top + height - viewport;
  else if (align === 'center') target = top + (height - viewport) / 2;
  else if (top < scrollTop) target = top;
  else if (top + height > scrollTop + viewport) target = height > viewport ? top : top + height - viewport;
  else target = scrollTop;
  return Math.min(Math.max(0, target), Math.max(0, layout.total - viewport));
}

/**
 * 锚点保持：排版从 `before` 变成 `after`（视口上方的行量出来与估计不同、行高变了）时 scrollTop 要补的量，让锚点那一行
 * （一般是视口顶上那一行）在屏幕上不动。锚点自己和它下面的行怎么变都不用补。
 */
export function anchorShift(before: RowLayout, after: RowLayout, anchorIndex: number): number {
  const last = Math.min(rowCount(before), rowCount(after));
  if (anchorIndex <= 0 || last <= 0) return 0;
  const i = Math.min(anchorIndex, last);
  return after.offsets[i]! - before.offsets[i]!;
}

/**
 * 粗估一段文字折成几行（行高估计用，量到真高之前顶着）：CJK、全角与表情按 1em 一个，其余按 0.5em（按 BaoCut 界面字体里
 * 英文小写为主的正文量出来的平均字宽，略偏宽一点）；显式换行各起一行。至少一行。
 */
export function estimateLines(text: string, width: number, fontSize: number): number {
  if (width <= 0 || fontSize <= 0) return 1;
  const perLine = width / fontSize;
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    let em = 0;
    for (const char of paragraph) em += wide(char.codePointAt(0)!) ? 1 : 0.5;
    lines += Math.max(1, Math.ceil(em / perLine));
  }
  return Math.max(1, lines);
}

/** 东亚宽字符（CJK、假名、谚文、全角标点）与补充平面的字（表情、扩展汉字）。 */
function wide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code >= 0x1f000
  );
}
