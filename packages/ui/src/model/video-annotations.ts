import {
  VIDEO_ANNOTATION_LIMITS,
  VIDEO_ANNOTATION_TEXT_KINDS,
  type Id,
  type VideoAnnotation,
  type VideoAnnotationElement,
  type VideoAnnotationKind,
} from '@baocut/protocol';
import { VIDEO_NOTES } from './video-annotations-copy.ts';

/**
 * 视频标注（产品设计 §3.2.3「视频标注」、§5.3）：编辑器预览画面上框、箭头、文字与编号标记的草稿、画面上的标记与发送时交出去的那一份；
 * 标记工具（docs/design/lite-editor §4）另送来画笔、直线、圆、元素与评论，带颜色粗细、点中的元素、印章截图与落点。
 * 移植自原型 designs/baocut/app/model-stage-notes.js（`normalize`、`place`、`label`、`add`、`remove`、`pins`、`elsewhere`、
 * `candidateBounds`），与幻灯片、设计稿、设计系统标注同一套规则。纯函数，无 React、无 DOM。
 * 与另外三种的差别只有草稿的归属：这里按**视频**分（编辑器的快聊会话常常还没建），编号与另外三种各自从 1 起。
 * 拼给智能体的那段文字在 Harness（`withVideoAnnotations`），这里不拼。
 */

/** 草稿里的一条：协议的 `VideoAnnotation` 加只在界面里用的 id 与视频 id（删除、画面上的编号、跳到那一刻用）。 */
export type DraftVideoAnnotation = VideoAnnotation & { id: string; videoId: Id };

/**
 * 加不进去的原因：空的、超长的、超过条数的、箭头没拖到终点、框或圆没有面积；标记工具另有直线没拖到另一头、画笔不成一道、
 * 元素标注没点中元素。
 */
export type VideoAnnotationError =
  'empty' | 'too-long' | 'too-many' | 'no-arrow-end' | 'no-area' | 'no-line-end' | 'no-path' | 'no-element';

/** 画面上显示哪些标记的时间窗（毫秒）：播放头前后这么远以内的算「这一帧」。 */
export const VIDEO_ANNOTATION_NEAR_MS = 500;

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
export interface NormalizedShape {
  region: VideoAnnotation['region'];
  to?: Point;
  points?: Point[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * 把画面上的一次手势（相对画面左上角的像素）换成归一化的区域：起点与终点都夹在画面内，框与圆取两点围成的矩形，箭头与直线记起点与终点，
 * 画笔记一串点（`points`，像素；没给时只有起点）与它们的外接框，文字、编号、元素与评论只记一个点（w、h 为 0；元素的框由标记层按元素给）。
 * 与原型 model-stage-notes.js 的 `normalize`、model-markup.js 的 `fromGesture` 同一套。
 */
export function normalizeShape(
  kind: VideoAnnotationKind,
  from: Point,
  to: Point | null,
  frame: Size,
  points?: readonly Point[],
): NormalizedShape {
  const w = frame.w > 0 ? frame.w : 1;
  const h = frame.h > 0 ? frame.h : 1;
  const a = { x: clamp01(from.x / w), y: clamp01(from.y / h) };
  const b = to ? { x: clamp01(to.x / w), y: clamp01(to.y / h) } : a;
  if (kind === 'box' || kind === 'ellipse') {
    return {
      region: { x: round(Math.min(a.x, b.x)), y: round(Math.min(a.y, b.y)), w: round(Math.abs(a.x - b.x)), h: round(Math.abs(a.y - b.y)) },
    };
  }
  if (kind === 'arrow' || kind === 'line')
    return { region: { x: round(a.x), y: round(a.y), w: 0, h: 0 }, to: { x: round(b.x), y: round(b.y) } };
  if (kind === 'pen') {
    const pts = (points?.length ? points : [from]).map((p) => ({ x: round(clamp01(p.x / w)), y: round(clamp01(p.y / h)) }));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return { region: { x: x0, y: y0, w: round(Math.max(...xs) - x0), h: round(Math.max(...ys) - y0) }, points: pts };
  }
  return { region: { x: round(a.x), y: round(a.y), w: 0, h: 0 } };
}

export type Place = 'topLeft' | 'top' | 'topRight' | 'left' | 'center' | 'right' | 'bottomLeft' | 'bottom' | 'bottomRight';

/** 画面上的位置：按中心点分九宫。 */
export function placeOf(region: VideoAnnotation['region']): Place {
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;
  const col = cx < 1 / 3 ? 0 : cx > 2 / 3 ? 2 : 1;
  const row = cy < 1 / 3 ? 0 : cy > 2 / 3 ? 2 : 1;
  const grid: Place[][] = [
    ['topLeft', 'top', 'topRight'],
    ['left', 'center', 'right'],
    ['bottomLeft', 'bottom', 'bottomRight'],
  ];
  return grid[row]![col]!;
}

/** 标注的时码：`MM:SS.s`（满一小时带小时），先按 0.1 秒取整再拆分，与 Harness 拼给模型的一致。 */
export function annotationTimecode(ms: number): string {
  let s = Math.round(Math.max(0, ms) / 100) / 10;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const sec = `${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  return h > 0 ? `${h}:${pad(m)}:${sec}` : `${pad(m)}:${sec}`;
}

/** 元素的说法里引用的文字：空白并成一个空格，过长截断（与原型 model-markup.js 的 `trim` 一致）。 */
const clip = (value: string | undefined, max = 24): string => {
  const s = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * 点中元素给人看的说法（界面语言；lite-editor §4.1）：「字幕 · “它没有掉下来”」「元素 · logo」「button#play.bc-icon-button · 32 × 32」。
 * 给模型看的英文另在协议的 `videoAnnotationElementDetail`。
 */
export function videoAnnotationElementLabel(element: VideoAnnotationElement): string {
  if (element.kind === 'caption') return VIDEO_NOTES.elementCaption(clip(element.text));
  if (element.kind === 'element') return VIDEO_NOTES.elementNode(clip(element.text), element.id);
  return element.w && element.h ? `${element.selector} · ${Math.round(element.w)} × ${Math.round(element.h)}` : element.selector;
}

/**
 * 给人看的位置：「00:42.3 · 框 · 画面右上」（界面语言）。点中了元素（元素、评论）时用元素的说法代替种类与九宫位置：
 * 「00:12.4 · 字幕 · “它没有掉下来”」；带落点时后面接段与句：「… · s03 · 第 2 句」（lite-editor §4.1、§4.2）。
 */
export function videoAnnotationLabel(
  note: Pick<VideoAnnotation, 'timeMs' | 'kind' | 'region'> & Partial<Pick<VideoAnnotation, 'element' | 'segment' | 'line'>>,
): string {
  const timecode = annotationTimecode(note.timeMs);
  const head = note.element
    ? `${timecode} · ${videoAnnotationElementLabel(note.element)}`
    : VIDEO_NOTES.label(timecode, VIDEO_NOTES.kinds[note.kind], VIDEO_NOTES.places[placeOf(note.region)]);
  if (!note.segment) return head;
  return `${head} · ${note.segment.id}${note.line ? ` · ${VIDEO_NOTES.lineNo(note.line.index)}` : ''}`;
}

/**
 * 新加一条：批注去掉首尾空白；超长的、超过条数的不收；空批注只有标记工具画的标记（带 `style`）收，文字与评论总得写。
 * 箭头与直线没有终点、框与圆没有面积、画笔不足两个点、元素标注没有元素的也不收。没给标签时按界面语言补上。
 */
export function addVideoAnnotation(
  list: readonly DraftVideoAnnotation[],
  note: DraftVideoAnnotation,
): { list: readonly DraftVideoAnnotation[]; error: VideoAnnotationError | null } {
  const text = note.text.trim();
  if (!text && (!note.style || (VIDEO_ANNOTATION_TEXT_KINDS as readonly string[]).includes(note.kind))) return { list, error: 'empty' };
  if (text.length > VIDEO_ANNOTATION_LIMITS.text) return { list, error: 'too-long' };
  if (list.length >= VIDEO_ANNOTATION_LIMITS.perMessage) return { list, error: 'too-many' };
  if (note.kind === 'arrow' && !note.to) return { list, error: 'no-arrow-end' };
  if ((note.kind === 'box' || note.kind === 'ellipse') && !(note.region.w > 0 && note.region.h > 0)) return { list, error: 'no-area' };
  if (note.kind === 'line' && !note.to) return { list, error: 'no-line-end' };
  if (note.kind === 'pen' && !((note.points?.length ?? 0) >= 2)) return { list, error: 'no-path' };
  if (note.kind === 'element' && !note.element) return { list, error: 'no-element' };
  return { list: [...list, { ...note, text, label: note.label || videoAnnotationLabel(note) }], error: null };
}

export function removeVideoAnnotation(list: readonly DraftVideoAnnotation[], id: string): readonly DraftVideoAnnotation[] {
  return list.some((n) => n.id === id) ? list.filter((n) => n.id !== id) : list;
}

/** 画面上要画的标记带的编号：在整份草稿里的序号，与 composer 列表一致。 */
export type VideoAnnotationPin = DraftVideoAnnotation & { n: number };

/** 只画这部视频、播放头附近（±near 毫秒）那一帧的；别的时刻的在 composer 的列表里，点一条跳过去。 */
export function videoAnnotationPins(
  list: readonly DraftVideoAnnotation[],
  videoId: Id,
  playheadSeconds: number,
  near = VIDEO_ANNOTATION_NEAR_MS,
): VideoAnnotationPin[] {
  const at = (playheadSeconds || 0) * 1000;
  return list.flatMap((n, i) => (n.videoId === videoId && Math.abs(n.timeMs - at) <= near ? [{ ...n, n: i + 1 }] : []));
}

/** 这部视频不在当前帧上的有几条（标注模式的状态行）。 */
export function videoAnnotationsElsewhere(
  list: readonly DraftVideoAnnotation[],
  videoId: Id,
  playheadSeconds: number,
  near = VIDEO_ANNOTATION_NEAR_MS,
): number {
  const at = (playheadSeconds || 0) * 1000;
  return list.filter((n) => n.videoId === videoId && Math.abs(n.timeMs - at) > near).length;
}

/** 多帧标注的候选区间：同一视频两条以上时给出最早与最晚的时刻，只有一条时为 null。只是候选，不是要改的区间。 */
export function candidateBounds(list: readonly DraftVideoAnnotation[], videoId: Id): { fromMs: number; toMs: number } | null {
  const times = list.filter((n) => n.videoId === videoId).map((n) => n.timeMs);
  if (times.length < 2) return null;
  return { fromMs: Math.min(...times), toMs: Math.max(...times) };
}

/** 随消息交出去的那一份：去掉界面里的 id 与视频 id，只带协议里的字段、按协议排（协议不收别的字段）。 */
export function sentVideoAnnotations(list: readonly DraftVideoAnnotation[]): VideoAnnotation[] {
  return list.map(({ video, revision, timeMs, kind, region, to, points, style, element, shot, segment, line, label, text }) => ({
    video,
    revision,
    timeMs,
    kind,
    region: { ...region },
    ...(to ? { to: { ...to } } : {}),
    ...(points ? { points: points.map((p) => ({ x: p.x, y: p.y })) } : {}),
    ...(style ? { style: { ...style } } : {}),
    ...(element ? { element: { ...element } } : {}),
    ...(shot ? { shot: { timeMs: shot.timeMs, ...(shot.stamp ? { stamp: { ...shot.stamp } } : {}) } } : {}),
    ...(segment ? { segment: { ...segment } } : {}),
    ...(line ? { line: { ...line } } : {}),
    label,
    text,
  }));
}

/** 加不进去的原因说成话（界面语言）。 */
export function videoAnnotationErrorText(error: VideoAnnotationError): string {
  switch (error) {
    case 'empty':
      return VIDEO_NOTES.empty;
    case 'too-long':
      return VIDEO_NOTES.tooLong(VIDEO_ANNOTATION_LIMITS.text);
    case 'too-many':
      return VIDEO_NOTES.tooMany(VIDEO_ANNOTATION_LIMITS.perMessage);
    case 'no-arrow-end':
      return VIDEO_NOTES.noArrowEnd;
    case 'no-area':
      return VIDEO_NOTES.noArea;
    case 'no-line-end':
      return VIDEO_NOTES.noLineEnd;
    case 'no-path':
      return VIDEO_NOTES.noPath;
    case 'no-element':
      return VIDEO_NOTES.noElement;
  }
}
