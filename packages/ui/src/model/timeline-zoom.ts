import type { Id, Sequence } from '@baocut/protocol';
import { itemFrames, trackRows } from './editor.ts';

/**
 * 时间线缩放（原型 model-timeline.js 的缩放一节与 data.js `zoomMenu`）：每秒多少像素是真相值，百分比只是显示。
 * 横向几何 x = PAD + t × pxPerSecond，x 是泳道视口坐标（不含行头列）；`lane` 是泳道视口的宽。
 * 缩小的下限 = min(ZOOM_MIN, 整片铺满泳道的值)：短视频照旧停在 ZOOM_MIN，长视频总能缩到整片入镜（可以小于 1%）。
 */

export const ZOOM_MIN = 4;
export const ZOOM_MAX = 400;
/** = 100%。 */
export const ZOOM_DEFAULT = 40;
/** 放大 / 缩小一步的倍数。 */
export const ZOOM_STEP = 1.5;
/** 「缩放到播放头」= 200%。 */
export const ZOOM_PLAYHEAD = ZOOM_DEFAULT * 2;
/** 泳道左右的内边距（与 timeline.tsx 同一个值）。 */
export const ZOOM_PAD = 12;

export type ZoomAction = 'in' | 'out' | '100' | 'fit' | 'fitClip' | 'playhead' | 'fitSelection';

/** 菜单的顺序与快捷键（按 macOS 写，别的平台用 key-labels 换成 Ctrl+ / Alt+）。 */
export const ZOOM_MENU: readonly { id: ZoomAction; keys: string }[] = [
  { id: 'in', keys: '⌘=' },
  { id: 'out', keys: '⌘−' },
  { id: '100', keys: '⌘0' },
  { id: 'fit', keys: '⌥⌘1' },
  { id: 'fitClip', keys: '⌥⌘2' },
  { id: 'playhead', keys: '⌥⌘3' },
  { id: 'fitSelection', keys: '⌥⌘4' },
];

/** 让 `seconds` 正好铺满泳道（两边各留 PAD）的每秒像素数。 */
export function fitPxPerSecond(seconds: number, lane: number): number {
  return seconds > 0 ? (lane - ZOOM_PAD * 2) / seconds : ZOOM_DEFAULT;
}

/** 缩小的下限；没有时长或泳道还没量出来（≤ 2×PAD）时退回 ZOOM_MIN。 */
export function zoomFloor(duration: number, lane: number): number {
  if (!(duration > 0) || !(lane > ZOOM_PAD * 2)) return ZOOM_MIN;
  return Math.min(ZOOM_MIN, fitPxPerSecond(duration, lane));
}

/** 夹到 [min(ZOOM_MIN, floor), ZOOM_MAX]。`floor` 大于 ZOOM_MIN 时不抬高下限。 */
export function clampZoom(pxPerSecond: number, floor: number): number {
  const min = Math.min(ZOOM_MIN, floor > 0 ? floor : ZOOM_MIN);
  return Math.min(ZOOM_MAX, Math.max(min, pxPerSecond));
}

/**
 * 百分比标签，100% = ZOOM_DEFAULT。≥10 取整（"22%"）；1–10 留一位小数、去掉多余的 .0（"4.4%"、"5%"）；
 * <1 取两位有效数字、去掉末尾的 0（"0.42%"、"0.05%"）。进位跨档（9.96 → "10%"）不写成 "10.0%"，有效缩放永远不显示 "0%"。
 */
export function zoomLabel(pxPerSecond: number): string {
  const pct = (pxPerSecond / ZOOM_DEFAULT) * 100;
  if (!(pct > 0) || !Number.isFinite(pct)) return '—';
  if (pct >= 10) return `${Math.round(pct)}%`;
  const text = pct >= 1 ? pct.toFixed(1) : pct.toPrecision(2);
  return `${text.includes('.') ? text.replace(/\.?0+$/, '') : text}%`;
}

/** 缩放前后的视图：时间都是秒，`scroll` 是泳道的横向滚动偏移。 */
export interface ZoomView {
  pxPerSecond: number;
  scroll: number;
  lane: number;
  duration: number;
  playhead: number;
}

/** 把时刻 `seconds` 放在泳道视口的 `x` 处时的滚动偏移（不小于 0；右端由内容宽度自然收住）。 */
export function anchoredScroll(seconds: number, x: number, pxPerSecond: number): number {
  return Math.max(0, ZOOM_PAD + seconds * pxPerSecond - x);
}

/** 锚点缩放的锚：播放头在视口内就让它留在原来的屏幕 x，否则让视口中线对应的时刻不动。 */
export function zoomAnchor(view: ZoomView): { seconds: number; x: number } {
  const lane = Math.max(0, view.lane);
  const x = ZOOM_PAD + view.playhead * view.pxPerSecond - view.scroll;
  if (x >= 0 && x <= lane) return { seconds: view.playhead, x };
  return { seconds: (view.scroll + lane / 2 - ZOOM_PAD) / view.pxPerSecond, x: lane / 2 };
}

/**
 * 缩放动作 → 新的每秒像素数与滚动偏移；要不到结果（适应片段 / 所选却没有区间）时返回 null。
 * in / out / 100：锚点缩放；fit：整片入镜并回到 0；playhead：放到 200% 并让播放头居中；
 * fitClip / fitSelection：让区间铺满视口并居中（到了上限铺不满也居中）。
 */
export function zoomPlan(action: ZoomAction, view: ZoomView, span?: { start: number; end: number } | null): ZoomView | null {
  const floor = zoomFloor(view.duration, view.lane);
  const at = (pxPerSecond: number, scroll: number): ZoomView => ({ ...view, pxPerSecond, scroll });
  const keep = (next: number) => {
    const pxPerSecond = clampZoom(next, floor);
    const anchor = zoomAnchor(view);
    return at(pxPerSecond, anchoredScroll(anchor.seconds, anchor.x, pxPerSecond));
  };
  const centerOn = (seconds: number, pxPerSecond: number) =>
    at(pxPerSecond, anchoredScroll(seconds, Math.max(0, view.lane) / 2, pxPerSecond));
  switch (action) {
    case 'in':
      return keep(view.pxPerSecond * ZOOM_STEP);
    case 'out':
      return keep(view.pxPerSecond / ZOOM_STEP);
    case '100':
      return keep(ZOOM_DEFAULT);
    case 'fit':
      return at(clampZoom(fitPxPerSecond(view.duration, view.lane), floor), 0);
    case 'playhead':
      return centerOn(view.playhead, clampZoom(ZOOM_PLAYHEAD, floor));
    case 'fitClip':
    case 'fitSelection': {
      if (!span) return null;
      const length = Math.max(0.1, span.end - span.start);
      return centerOn(span.start + length / 2, clampZoom(fitPxPerSecond(length, view.lane), floor));
    }
  }
}

/** 区间（秒）。 */
export interface Span {
  start: number;
  end: number;
}

function spanOf(sequence: Sequence, ids: readonly Id[]): Span | null {
  const perSecond = sequence.fps.num / sequence.fps.den;
  let span: Span | null = null;
  for (const item of sequence.items) {
    if (!ids.includes(item.id)) continue;
    const { start, end } = itemFrames(item, sequence.fps);
    span = span
      ? { start: Math.min(span.start, start / perSecond), end: Math.max(span.end, end / perSecond) }
      : { start: start / perSecond, end: end / perSecond };
  }
  return span;
}

/**
 * 「适应当前片段」的区间：播放头下的片段。选中的片段里有盖住播放头的就用它；否则取最上面一条画面轨道上、
 * 播放头下的视频片段。都没有返回 null。
 */
export function clipSpanAt(sequence: Sequence, selection: readonly Id[], playhead: number): Span | null {
  const frame = (playhead * sequence.fps.num) / sequence.fps.den;
  const covers = (id: Id) => {
    const item = sequence.items.find((candidate) => candidate.id === id);
    if (!item) return false;
    const { start, end } = itemFrames(item, sequence.fps);
    return start <= frame + 1e-6 && end > frame + 1e-6;
  };
  const selected = selection.find(covers);
  if (selected) return spanOf(sequence, [selected]);
  for (const { track } of trackRows(sequence)) {
    if (track.kind !== 'visual') continue;
    const hit = sequence.items.find((item) => item.trackId === track.id && item.type === 'video' && covers(item.id));
    if (hit) return spanOf(sequence, [hit.id]);
  }
  return null;
}

/** 「适应所选」的区间：选中各件的并集；没有选中返回 null。 */
export function selectionSpan(sequence: Sequence, selection: readonly Id[]): Span | null {
  return selection.length ? spanOf(sequence, selection) : null;
}

const ALT_DIGITS: Record<string, ZoomAction> = { '1': 'fit', '2': 'fitClip', '3': 'playhead', '4': 'fitSelection' };

/**
 * 键盘事件对应哪个缩放动作（与 ZOOM_MENU 的快捷键一一对应），不是缩放键返回 null。`mod` 是 macOS 的 ⌘、别处的 Ctrl。
 * 按住 ⌥ 时 macOS 的 `key` 是特殊字符，数字键一律认 `code`。
 */
export function zoomKey(event: { key: string; code: string; altKey: boolean; shiftKey: boolean }, mod: boolean): ZoomAction | null {
  if (!mod) return null;
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code)?.[1];
  if (event.altKey) {
    if (event.shiftKey || !digit) return null;
    return ALT_DIGITS[digit] ?? null;
  }
  const { key, code } = event;
  if (code === 'Equal' || code === 'NumpadAdd' || key === '=' || key === '+') return 'in';
  if (code === 'Minus' || code === 'NumpadSubtract' || key === '-' || key === '−') return 'out';
  if (!event.shiftKey && (digit === '0' || key === '0')) return '100';
  return null;
}
