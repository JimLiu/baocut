import {
  VIDEO_ANNOTATION_COLORS,
  VIDEO_ANNOTATION_FONTS,
  VIDEO_ANNOTATION_TEXT_KINDS,
  VIDEO_ANNOTATION_TEXT_SIZES,
  VIDEO_ANNOTATION_WIDTHS,
  newId,
  videoAnnotationElementDetail,
  type CompositionBridgePick,
  type FileTarget,
  type Id,
  type Revision,
  type Sequence,
  type SequenceItem,
  type VideoAnnotation,
  type VideoAnnotationColor,
  type VideoAnnotationElement,
  type VideoAnnotationKind,
  type VideoAnnotationTextStyle,
  type VideoAnnotationWidth,
} from '@baocut/protocol';
import type { VisualLayer } from '../render/frame-plan.ts';
import type { CaptionHit } from '../render/render-planner.ts';
import { liteLineAt, liteSegmentAt, type LiteSegment } from './lite-segments.ts';
import { captionHitAt, hitAt, isMainVideo } from './stage-hit.ts';
import { aabbOf, boundsOf, type Pose, type Rect } from './stage-pose.ts';
import { safeFileStem } from './export-settings.ts';
import {
  normalizeShape,
  VIDEO_ANNOTATION_NEAR_MS,
  videoAnnotationLabel,
  type DraftVideoAnnotation,
  type Point,
  type Size,
} from './video-annotations.ts';

/*
 * 轻量编辑器的标记（docs/design/lite-editor §4；移植自原型 designs/baocut/app/model-markup.js）：标注模式里画在画面上的一组标记——
 * 画笔、直线、箭头、矩形、圆、编号、文字，「选择元素」点中的舞台元素（字幕、元素），以及「评论」——点画面任意位置落一枚印章、写一句话，
 * 点中了元素就连元素一起。纯函数，无 React、无 DOM。
 *
 * 与视频标注（video-annotations.ts）的分工：这里是**画的过程**——一次标注会话里的标记、颜色与粗细、撤销重做、选中与改形；按「添加到对话」时
 * 整组换成视频标注（`toNotes`），进这部视频的草稿（draft-video-annotations-store），之后的事归 video-annotations。
 * 标记直接用协议的种类（矩形是 `box`、编号是 `pin`），不另起一套名字。标记本身不带批注，文字标记的内容与评论的话才进批注。
 * 几何一律相对画面归一化（0–1，左上为原点）：{x, y, w, h} 是外接框；直线 / 箭头另带 `to`（终点，起点是 x, y）；画笔带 `points[]`；
 * 文字、编号与评论只有一个点（w、h 为 0）；元素标记的框是元素在画面上的位置。
 */

/**
 * 工具条上的工具（lite-editor §4.1）：选择元素 / 评论 / 画笔 / 形状 / 文字。开着的工具底下另有一条副工具条：形状的一排形状、文字的
 * 粗体 / 斜体 / 下划线 / 字号 / 字体，右边是颜色与粗细（文字与评论没有粗细）。
 */
export const MARKUP_TOOLS = ['element', 'comment', 'pen', 'shape', 'text'] as const;
export type MarkupTool = (typeof MARKUP_TOOLS)[number];
/**
 * 标记的两种用法（lite-editor §4.1、§8）：`agent` 把标记「添加到对话」变成视频标注（Electron）；`screenshot` 是 Web 的截图模式——
 * 没有 BaoCut 会话可发，标记画在当前帧上复制或下载成图片，没有评论（选择元素保留，元素框的标签画进图片）。宿主只在这里分档：`markupMode(platform)`。
 */
export type MarkupMode = 'agent' | 'screenshot';
export const markupMode = (platform: string): MarkupMode => (platform === 'web' ? 'screenshot' : 'agent');
const SCREENSHOT_TOOLS: readonly MarkupTool[] = ['element', 'pen', 'shape', 'text'];
/** 这种用法下工具条上有哪些工具（按工具条的顺序）。 */
export const markupTools = (mode: MarkupMode): readonly MarkupTool[] => (mode === 'screenshot' ? SCREENSHOT_TOOLS : MARKUP_TOOLS);
export const MARKUP_SHAPES = ['line', 'arrow', 'box', 'ellipse', 'pin'] as const satisfies readonly VideoAnnotationKind[];
export type MarkupShape = (typeof MARKUP_SHAPES)[number];
/** 颜色与粗细与协议的 `style` 同一组：红 / 蓝 / 绿 / 黑 / 白，2 / 4 / 8 / 12 px；默认红、4px。 */
export const MARKUP_COLORS = VIDEO_ANNOTATION_COLORS;
export const MARKUP_WIDTHS = VIDEO_ANNOTATION_WIDTHS;
/** 这个工具画的标记有没有粗细：文字的大小走字号，评论是印章，副工具条上不给粗细。 */
export const hasWidth = (tool: MarkupTool): boolean => tool !== 'text' && tool !== 'comment';
/** 文字标记的字号与字体与协议的文字样式同一组：16 / 20 / 28 / 36 / 48 px，无衬线 / 衬线 / 等宽。 */
export const MARKUP_TEXT_SIZES = VIDEO_ANNOTATION_TEXT_SIZES;
export const MARKUP_FONTS = VIDEO_ANNOTATION_FONTS;
/** 文字的样子：工具条上的当前值与每条文字标记都是这五项；默认粗体、20px、无衬线。 */
export type MarkupTextStyle = Required<VideoAnnotationTextStyle>;
export const MARKUP_TEXT_STYLE: MarkupTextStyle = { bold: true, italic: false, underline: false, size: 20, font: 'sans' };
const TEXT_STYLE_KEYS = ['bold', 'italic', 'underline', 'size', 'font'] as const satisfies readonly (keyof MarkupTextStyle)[];
/** 字号还跟粗细档走时的对应（旧的文字标记与没带字号的标注按它画）。 */
const OLD_TEXT_SIZE: Record<VideoAnnotationWidth, MarkupTextStyle['size']> = { 2: 16, 4: 20, 8: 28, 12: 36 };
/** 一条文字标记的样子：带了的照它，没带的取默认；没带字号的按粗细档的旧对应。 */
export function textStyleOf(m: Pick<Mark, 'width'> & VideoAnnotationTextStyle): MarkupTextStyle {
  const own = pickTextStyle(m);
  return { ...MARKUP_TEXT_STYLE, size: OLD_TEXT_SIZE[m.width] ?? MARKUP_TEXT_STYLE.size, ...own };
}
/** 只取带了的文字样式字段。 */
function pickTextStyle(src: VideoAnnotationTextStyle): VideoAnnotationTextStyle {
  const out: Record<string, unknown> = {};
  for (const k of TEXT_STYLE_KEYS) if (src[k] !== undefined) out[k] = src[k];
  return out as VideoAnnotationTextStyle;
}
/** 矩形、圆与元素框的八枚把手；直线 / 箭头两端是 `from` / `to`。 */
export const BOX_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type MarkupHandle = (typeof BOX_HANDLES)[number] | 'from' | 'to';

const HISTORY_MAX = 50;
const MIN_SIZE = 0.01;
const BOXED: readonly VideoAnnotationKind[] = ['box', 'ellipse', 'element'];

/**
 * 画面上的一条标记。`timeMs` 是画它时的播放头（毫秒）：标记属于那一帧，播放头离开那一帧就不画它（±`VIDEO_ANNOTATION_NEAR_MS`，
 * 同草稿里的标注），发出去时各带自己的时刻。`elementBox` 是评论点中的那个元素的框（只给画面上画高亮，不进标注）。文字标记另带
 * 粗体、斜体、下划线、字号与字体（`textStyleOf` 补齐没带的）。
 */
export interface Mark extends VideoAnnotationTextStyle {
  id: string;
  timeMs: number;
  kind: VideoAnnotationKind;
  color: VideoAnnotationColor;
  width: VideoAnnotationWidth;
  x: number;
  y: number;
  w: number;
  h: number;
  to?: Point;
  points?: Point[];
  text?: string;
  element?: VideoAnnotationElement;
  elementBox?: Rect;
}
/** 加一条时给的：颜色、粗细与 id 可以不给（取当前值、新起一个）；`timeMs` 必须给（画它时的播放头）。 */
export type MarkInput = Omit<Mark, 'id' | 'color' | 'width'> & Partial<Pick<Mark, 'id' | 'color' | 'width'>>;

export interface MarkupState {
  /** 这一组标记的用法：决定有哪些工具、最后是添加到对话还是复制 / 下载图片。 */
  mode: MarkupMode;
  tool: MarkupTool;
  shape: MarkupShape;
  color: VideoAnnotationColor;
  width: VideoAnnotationWidth;
  /** 文字工具的当前样子：新写的文字标记带它。 */
  textStyle: MarkupTextStyle;
  marks: Mark[];
  past: Mark[][];
  future: Mark[][];
  sel: string | null;
  /** 关闭时有还没发的标记：问一句「放弃这些标记？」。 */
  ask: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const round = (v: number) => Math.round(v * 1000) / 1000;

export function init(over: Partial<MarkupState> = {}): MarkupState {
  return {
    mode: 'agent',
    tool: 'pen',
    shape: 'box',
    color: 'red',
    width: 4,
    textStyle: MARKUP_TEXT_STYLE,
    marks: [],
    past: [],
    future: [],
    sel: null,
    ask: false,
    ...over,
  };
}

/** 换工具：换了就取消选中；这种用法下没有的工具（截图模式的选择元素与评论）不换。 */
export const setTool = (s: MarkupState, tool: MarkupTool): MarkupState =>
  markupTools(s.mode).includes(tool) ? { ...s, tool, sel: tool === s.tool ? s.sel : null } : s;
export const setShape = (s: MarkupState, shape: MarkupShape): MarkupState => ({ ...s, shape, tool: 'shape', sel: null });

/** 一次改动进历史：过去栈封顶 50，未来栈清空。 */
function commit(s: MarkupState, marks: Mark[], sel: string | null = s.sel): MarkupState {
  const past = [...s.past, s.marks].slice(-HISTORY_MAX);
  return { ...s, marks, past, future: [], sel: sel != null && marks.some((m) => m.id === sel) ? sel : null };
}

/** 颜色 / 粗细：改当前值；有选中的标记就连它一起改（进历史）。 */
export function setColor(s: MarkupState, color: VideoAnnotationColor): MarkupState {
  const next = { ...s, color };
  return s.sel
    ? commit(
        next,
        s.marks.map((m) => (m.id === s.sel ? { ...m, color } : m)),
      )
    : next;
}
export function setWidth(s: MarkupState, width: VideoAnnotationWidth): MarkupState {
  const next = { ...s, width };
  return s.sel
    ? commit(
        next,
        s.marks.map((m) => (m.id === s.sel ? { ...m, width } : m)),
      )
    : next;
}

/** 文字的样子：改当前值；选中的是文字标记就连它一起改（进历史）。 */
export function setTextStyle(s: MarkupState, patch: Partial<MarkupTextStyle>): MarkupState {
  const next = { ...s, textStyle: { ...s.textStyle, ...pickTextStyle(patch) } };
  const sel = s.sel ? s.marks.find((m) => m.id === s.sel) : undefined;
  return sel?.kind === 'text'
    ? commit(
        next,
        s.marks.map((m) => (m.id === sel.id ? { ...m, ...textStyleOf(m), ...pickTextStyle(patch) } : m)),
      )
    : next;
}

/** 加一条：带当前颜色与粗细（给了就用给的）、画它时的播放头，文字另带当前的样子，加完选中它。 */
export function add(s: MarkupState, mark: MarkInput): MarkupState {
  const m: Mark = {
    ...(mark.kind === 'text' ? s.textStyle : null),
    ...mark,
    id: mark.id || newId('mk'),
    color: mark.color ?? s.color,
    width: mark.width ?? s.width,
  };
  return commit(s, [...s.marks, m], m.id);
}
/** 改一条：默认进历史；拖动中的连续改动传 `{ history: false }`，松手再 `finishDrag` 记一次。 */
export function update(s: MarkupState, id: string, patch: Partial<Mark>, opts?: { history?: boolean }): MarkupState {
  const marks = s.marks.map((m) => (m.id === id ? { ...m, ...patch } : m));
  return opts?.history === false ? { ...s, marks } : commit(s, marks);
}
/** 拖动结束：拖的过程用 `{ history: false }` 改过了，这里把拖前的那一版记进历史（没动就不记）。 */
export function finishDrag(s: MarkupState, id: string, orig: Mark | undefined): MarkupState {
  const cur = s.marks.find((m) => m.id === id);
  if (!cur || !orig || JSON.stringify(cur) === JSON.stringify(orig)) return s;
  return commit({ ...s, marks: s.marks.map((m) => (m.id === id ? orig : m)) }, s.marks, id);
}
export const remove = (s: MarkupState, id: string): MarkupState =>
  s.marks.some((m) => m.id === id)
    ? commit(
        s,
        s.marks.filter((m) => m.id !== id),
        null,
      )
    : s;
export const clear = (s: MarkupState): MarkupState => (s.marks.length ? commit(s, [], null) : s);
/**
 * 已经发出去的几条：从画面与整段历史里一起拿掉（撤销不再把它们带回来，免得发两遍）。评论勾着「发给智能体」发出、
 * 「添加到对话」中途有一条加不进去时，已经加进去的那几条走这里。
 */
export function forget(s: MarkupState, ids: readonly string[]): MarkupState {
  if (!ids.length) return s;
  const gone = new Set(ids);
  const keep = (list: Mark[]) => list.filter((m) => !gone.has(m.id));
  return { ...s, marks: keep(s.marks), past: s.past.map(keep), future: s.future.map(keep), sel: s.sel && gone.has(s.sel) ? null : s.sel };
}
export const select = (s: MarkupState, id: string | null): MarkupState => ({
  ...s,
  sel: id != null && s.marks.some((m) => m.id === id) ? id : null,
});
export const canUndo = (s: MarkupState) => s.past.length > 0;
export const canRedo = (s: MarkupState) => s.future.length > 0;
export function undo(s: MarkupState): MarkupState {
  if (!canUndo(s)) return s;
  const marks = s.past[s.past.length - 1]!;
  return { ...s, marks, past: s.past.slice(0, -1), future: [s.marks, ...s.future], sel: null };
}
export function redo(s: MarkupState): MarkupState {
  if (!canRedo(s)) return s;
  const marks = s.future[0]!;
  return { ...s, marks, past: [...s.past, s.marks], future: s.future.slice(1), sel: null };
}

const needsText = (kind: VideoAnnotationKind) => (VIDEO_ANNOTATION_TEXT_KINDS as readonly string[]).includes(kind);
/** 能发出去的标记：没写字的文字标记与评论不算。 */
export const sendable = (marks: readonly Mark[]): Mark[] => marks.filter((m) => !needsText(m.kind) || !!String(m.text ?? '').trim());
/** 编号标记的序号：按加入顺序，从 1 起（撤销 / 删掉中间一枚后面的会重排）；每次「添加到对话」后这一组清空，下一组从 1 重来。 */
export function stepNumber(marks: readonly Mark[], id: string): number | null {
  const i = marks.filter((m) => m.kind === 'pin').findIndex((m) => m.id === id);
  return i < 0 ? null : i + 1;
}

/** 几何部分。 */
export type MarkGeometry = Pick<Mark, 'x' | 'y' | 'w' | 'h' | 'to' | 'points'>;

/** 画面上的一次手势（相对画面的像素）换成一条标记的几何：同 `normalizeShape`，摊平成 {x, y, w, h, to?, points?}。 */
export function fromGesture(
  kind: VideoAnnotationKind,
  from: Point,
  to: Point | null,
  frame: Size,
  points?: readonly Point[],
): MarkGeometry {
  const shape = normalizeShape(kind, from, to, frame, points);
  return { ...shape.region, ...(shape.to ? { to: shape.to } : {}), ...(shape.points ? { points: shape.points } : {}) };
}

function bbox(pts: readonly Point[]): Rect {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: round(x0), y: round(y0), w: round(Math.max(...xs) - x0), h: round(Math.max(...ys) - y0) };
}
/** 外接框：直线 / 箭头按两端算，别的就是自己的框。 */
export function bounds(m: MarkGeometry & { kind: VideoAnnotationKind }): Rect {
  if ((m.kind === 'line' || m.kind === 'arrow') && m.to) return bbox([{ x: m.x, y: m.y }, m.to]);
  return { x: m.x, y: m.y, w: m.w || 0, h: m.h || 0 };
}

/** 整条平移（归一化的 dx、dy），外接框不出画面；点列与终点一起挪。 */
export function move<M extends MarkGeometry & { kind: VideoAnnotationKind }>(m: M, dx: number, dy: number): M {
  const b = bounds(m);
  const ddx = Math.min(1 - b.w - b.x, Math.max(-b.x, dx));
  const ddy = Math.min(1 - b.h - b.y, Math.max(-b.y, dy));
  const sh = (p: Point) => ({ x: round(p.x + ddx), y: round(p.y + ddy) });
  const next: M = { ...m, ...sh(m) };
  if (m.to) next.to = sh(m.to);
  if (m.points) next.points = m.points.map(sh);
  return next;
}

/** 把手：矩形、圆与元素框八枚，直线 / 箭头两端；文字、编号、画笔、评论只能挪。 */
export function handles(m: MarkGeometry & { kind: VideoAnnotationKind }): { k: MarkupHandle; x: number; y: number }[] {
  if (BOXED.includes(m.kind)) {
    const cx = m.x + m.w / 2;
    const cy = m.y + m.h / 2;
    const r = m.x + m.w;
    const bt = m.y + m.h;
    const at: Record<(typeof BOX_HANDLES)[number], [number, number]> = {
      nw: [m.x, m.y],
      n: [cx, m.y],
      ne: [r, m.y],
      e: [r, cy],
      se: [r, bt],
      s: [cx, bt],
      sw: [m.x, bt],
      w: [m.x, cy],
    };
    return BOX_HANDLES.map((k) => ({ k, x: round(at[k][0]), y: round(at[k][1]) }));
  }
  if ((m.kind === 'line' || m.kind === 'arrow') && m.to)
    return [
      { k: 'from', x: m.x, y: m.y },
      { k: 'to', x: m.to.x, y: m.to.y },
    ];
  return [];
}
/** 拖把手：框按边改（最小 1%，不出画面）；直线 / 箭头挪那一端。 */
export function resize<M extends MarkGeometry>(m: M, handle: MarkupHandle, dx: number, dy: number): M {
  if (handle === 'from' || handle === 'to') {
    const p = handle === 'from' ? { x: m.x, y: m.y } : (m.to ?? { x: m.x, y: m.y });
    const q = { x: round(clamp01(p.x + dx)), y: round(clamp01(p.y + dy)) };
    return handle === 'from' ? { ...m, x: q.x, y: q.y } : { ...m, to: q };
  }
  let x0 = m.x;
  let y0 = m.y;
  let x1 = m.x + m.w;
  let y1 = m.y + m.h;
  if (handle.includes('w')) x0 = Math.min(clamp01(x0 + dx), x1 - MIN_SIZE);
  if (handle.includes('e')) x1 = Math.max(clamp01(x1 + dx), x0 + MIN_SIZE);
  if (handle.includes('n')) y0 = Math.min(clamp01(y0 + dy), y1 - MIN_SIZE);
  if (handle.includes('s')) y1 = Math.max(clamp01(y1 + dy), y0 + MIN_SIZE);
  return { ...m, x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
}

// ---- 选择元素 ----

/** 指针下点中的舞台元素：框（画布像素）与它是谁（协议的 `VideoAnnotationElement`，`detail` 留给 `toNotes` 补）。 */
export interface MarkupPick {
  rect: Rect;
  element: VideoAnnotationElement;
}

/**
 * 画布上某一点（画布像素）点中了什么（lite-editor §4.1「元素是什么」）：先找字幕行（`captionHits`，同一句的几行并成一个框，
 * 记 `{kind: 'caption', id: '<字幕实例>:<句>', text}`），再找画面元素（帧计划里从上往下第一件盖住这个点的，铺满画面的主视频不算；
 * 记 `{kind: 'element', id, text}`，框是 `poseOf` 给的布局框的外包盒，裁在画布内）。
 * 命中的是实时合成层那件（`wantsLivePick`）时，标记层再经实时合成层问 iframe 里最内层的节点（`htmlPick`，lite-editor §11 第 12 条），
 * 问到了用它，问不到退回这里的元素命中；这里是同步的那一半。
 */
export function pickElement(input: {
  point: Point;
  canvas: { width: number; height: number };
  captionHits: readonly CaptionHit[];
  layers: readonly VisualLayer[];
  sequence: Sequence;
  /** 实例的布局框（画布像素）；没有布局框的（音频、字幕）给 null。 */
  poseOf: (item: SequenceItem) => Pose | null;
  /** 字幕那一句的文字；正文还没取到时 undefined。 */
  cueText?: (hit: CaptionHit) => string | undefined;
}): MarkupPick | null {
  const { point, canvas, captionHits, layers, sequence } = input;
  const clip = (r: Rect): Rect => clipRect(r, canvas);
  const cue = captionHitAt(captionHits, point);
  if (cue) {
    const lines = captionHits.filter((h) => h.itemId === cue.itemId && h.cueId === cue.cueId);
    const rect = boundsOf(lines.map(aabbOf)) ?? aabbOf(cue);
    const text = input.cueText?.(cue)?.trim();
    return { rect: clip(rect), element: { kind: 'caption', id: `${cue.itemId}:${cue.cueId}`, ...(text ? { text } : {}) } };
  }
  const byId = new Map(sequence.items.map((item) => [item.id, item]));
  const id = hitAt(layers, point, {
    captionHits: [],
    skip: (itemId) => {
      const item = byId.get(itemId);
      return !item || isMainVideo(item, sequence);
    },
  });
  const item = id ? byId.get(id) : undefined;
  const pose = item ? input.poseOf(item) : null;
  if (!item || !pose) return null;
  const text = (item.type === 'text' ? item.text : undefined)?.trim() || item.name?.trim();
  return { rect: clip(aabbOf(pose)), element: { kind: 'element', id: item.id, ...(text ? { text } : {}) } };
}

function clipRect(r: Rect, canvas: { width: number; height: number }): Rect {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(canvas.width, r.x + r.w);
  const y1 = Math.min(canvas.height, r.y + r.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** 同步命中的是不是实时合成层那件（HTML 动画视频）：是就再问 iframe 里的节点。 */
export function wantsLivePick(pick: MarkupPick | null, liveItemId: Id | null | undefined): boolean {
  return !!pick && !!liveItemId && pick.element.kind === 'element' && pick.element.id === liveItemId;
}

/**
 * 实时合成层拾到的节点（框已换成画布像素，`node` 是页面回的说明）换成标记的拾取：记 `{kind: 'html', selector, w, h, name, role,
 * focusable}`（`w`、`h` 是节点在合成里的 CSS 像素，照 DevTools），框裁在画布内；框整个在画布外时是 null。
 */
export function htmlPick(hit: { rect: Rect; node: CompositionBridgePick }, canvas: { width: number; height: number }): MarkupPick | null {
  const rect = clipRect(hit.rect, canvas);
  if (!(rect.w > 0) || !(rect.h > 0)) return null;
  const { selector, w, h, name, role, focusable } = hit.node;
  return { rect, element: { kind: 'html', selector, w, h, ...(name ? { name } : {}), ...(role ? { role } : {}), focusable } };
}

/** 画布像素的框换成相对画面的归一化框。 */
export function normalizedRect(rect: Rect, canvas: { width: number; height: number }): Rect {
  const w = canvas.width > 0 ? canvas.width : 1;
  const h = canvas.height > 0 ? canvas.height : 1;
  const x = clamp01(rect.x / w);
  const y = clamp01(rect.y / h);
  return { x: round(x), y: round(y), w: round(clamp01((rect.x + rect.w) / w) - x), h: round(clamp01((rect.y + rect.h) / h) - y) };
}

// ---- 换成视频标注 ----

/** 标注的落点（lite-editor §4.2）：播放头所在的那一段与那一句；没有当前句时没有 `line`。 */
export type MarkupPlacement = Pick<VideoAnnotation, 'segment' | 'line'>;

/** 播放头（秒）在哪一段哪一句：段记 `{id, kind: 段的来源, index, title}`，句记 `{id, index: 在段里的句序（从 1 起）, text}`。 */
export function markupPlacement(segments: readonly LiteSegment[], seconds: number): MarkupPlacement {
  const segment = liteSegmentAt(segments, seconds);
  if (!segment) return {};
  const where: MarkupPlacement = { segment: { id: segment.id, kind: segment.source, index: segment.index, title: segment.title } };
  const line = liteLineAt(segment.lines, seconds);
  if (line) where.line = { id: line.id, index: segment.lines.indexOf(line) + 1, text: line.text };
  return where;
}

/** 整组共有的字段：哪部视频、哪个版本，与按时刻算落点用的段表（没有段表就不带落点）。 */
export interface MarkupNoteBase {
  videoId: Id;
  video: FileTarget;
  revision: Revision;
  segments?: readonly LiteSegment[];
}

/** 这条标记在 `nowMs` 这一帧上吗：时刻相差不超过 `VIDEO_ANNOTATION_NEAR_MS`（同草稿里的标注）。 */
export const isOnFrame = (mark: Pick<Mark, 'timeMs'>, nowMs: number): boolean => Math.abs(mark.timeMs - nowMs) <= VIDEO_ANNOTATION_NEAR_MS;
/** 画面上此刻显示的标记（`nowMs` 这一帧上的）。 */
export const marksOnFrame = (marks: readonly Mark[], nowMs: number): Mark[] => marks.filter((m) => isOnFrame(m, nowMs));

/**
 * 截图模式下载的文件名（lite-editor §4.1）：`<视频名>-00m12s400.png`，满一小时前面加 `1h`。视频名按导出的规则去掉文件名里不能用的字符
 * （`safeFileStem`）；时刻是播放头所在的那一帧，毫秒整数。
 */
export function screenshotFileName(videoName: string, timeMs: number): string {
  const ms = Math.max(0, Math.round(timeMs));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${safeFileStem(videoName)}-${h ? `${h}h` : ''}${pad(m)}m${pad(s)}s${pad(ms % 1000, 3)}.png`;
}

/** 这些标记落在哪几帧上（毫秒，按先后）：同一帧的几条共一张截图。 */
export function markFrames(marks: readonly Mark[]): number[] {
  return [...new Set(marks.map((m) => m.timeMs))].sort((a, b) => a - b);
}

/** 一枚书签：画过标记的一帧（`timeMs` 是这一帧里最早的那一刻，定位就去那里）与这一帧上能出图的标记条数。 */
export interface MarkedFrame {
  timeMs: number;
  count: number;
}

/**
 * 标记落在哪几帧上，按先后（lite-editor §4.1「标记帧的书签」）：时间线上的印章与工具条的书签列表都照它画。相隔不超过
 * `VIDEO_ANNOTATION_NEAR_MS` 的几刻在画面上一起显示，算同一帧（从这一帧最早的那一刻量起）。只数能发出去的标记。
 */
export function markedFrames(marks: readonly Mark[]): MarkedFrame[] {
  const out: MarkedFrame[] = [];
  for (const m of sendable(marks).sort((a, b) => a.timeMs - b.timeMs)) {
    const last = out[out.length - 1];
    if (last && m.timeMs - last.timeMs <= VIDEO_ANNOTATION_NEAR_MS) last.count += 1;
    else out.push({ timeMs: m.timeMs, count: 1 });
  }
  return out;
}

/** 时间线上的一枚印章：一帧，或挤在一起的几帧（`at` 是第一帧在整条上的位置，0–1）。 */
export interface BookmarkStamp {
  timeMs: number;
  at: number;
  frames: MarkedFrame[];
}

/**
 * 印章挤在一起时合成一枚（lite-editor §4.1）：从左往右，离这一枚的第一帧不到 `minGapPx` 像素的帧并进来，印章上写帧数。
 * `widthPx` 是整条的宽度，`durationMs` 是整片时长。
 */
export function bookmarkStamps(frames: readonly MarkedFrame[], durationMs: number, widthPx: number, minGapPx: number): BookmarkStamp[] {
  if (!(durationMs > 0)) return [];
  const out: BookmarkStamp[] = [];
  for (const frame of frames) {
    const at = Math.min(1, Math.max(0, frame.timeMs / durationMs));
    const last = out[out.length - 1];
    if (last && (at - last.at) * widthPx < minGapPx) last.frames.push(frame);
    else out.push({ timeMs: frame.timeMs, at, frames: [frame] });
  }
  return out;
}

/** 点一枚印章去哪：播放头不在它的帧上就去第一帧，在其中一帧上就去下一帧（到头回第一帧），挤在一起的几帧点几下轮一遍。 */
export function stampTarget(stamp: Pick<BookmarkStamp, 'frames'>, nowMs: number): number {
  const i = stamp.frames.findIndex((f) => isOnFrame(f, nowMs));
  return stamp.frames[(i + 1) % stamp.frames.length]!.timeMs;
}

/** 播放头在哪一枚书签的帧上（没有时 null）。 */
export function currentFrame(frames: readonly MarkedFrame[], nowMs: number): MarkedFrame | null {
  return frames.find((f) => isOnFrame(f, nowMs)) ?? null;
}

/**
 * 整组标记换成视频标注草稿（一条标记一条，跳过不能发的）：每条带自己的时刻与那一刻的落点；文字与评论的内容进 `text`，别的 `text`
 * 为空（说明写在对话里）；颜色与粗细进 `style`，文字另带它的样子；点中的元素进 `element`（带给模型看的 `detail`，不带画面上用的框）；每条带 `shot`
 * （哪一帧：那一帧的截图随消息附上），评论另记印章落在哪。标签按界面语言生成（`videoAnnotationLabel`：点中元素时说元素，带落点时
 * 接段与句）。只输出协议的字段与 id、视频 id。
 */
export function toNotes(marks: readonly Mark[], base: MarkupNoteBase): DraftVideoAnnotation[] {
  return sendable(marks).map((m) => {
    const where = base.segments ? markupPlacement(base.segments, m.timeMs / 1000) : {};
    const note: DraftVideoAnnotation = {
      id: m.id,
      videoId: base.videoId,
      video: base.video,
      revision: base.revision,
      timeMs: m.timeMs,
      kind: m.kind,
      region: { x: m.x, y: m.y, w: m.w || 0, h: m.h || 0 },
      style: m.kind === 'text' ? { color: m.color, width: m.width, ...textStyleOf(m) } : { color: m.color, width: m.width },
      label: '',
      text: needsText(m.kind) ? String(m.text ?? '').trim() : '',
    };
    if (m.to) note.to = { x: m.to.x, y: m.to.y };
    if (m.points) note.points = m.points.map((p) => ({ x: p.x, y: p.y }));
    if (m.element) note.element = elementForNote(m.element);
    note.shot = m.kind === 'comment' ? { timeMs: m.timeMs, stamp: { x: m.x, y: m.y } } : { timeMs: m.timeMs };
    if (where.segment) note.segment = { ...where.segment };
    if (where.line) note.line = { ...where.line };
    note.label = videoAnnotationLabel(note);
    return note;
  });
}

/**
 * 已进草稿的标注画回画面上用的标记（stage-notes.tsx）：几何、文字与元素照标注，颜色与粗细照 `style`——没有 `style` 的
 * （别的客户端送来的、没经标记工具的）按蓝色 2px 画；文字的样子也照 `style`。`toNotes` 的反向，只取画它要用的字段。
 */
export function markOfAnnotation(note: DraftVideoAnnotation): Mark {
  const mark: Mark = {
    id: note.id,
    timeMs: note.timeMs,
    kind: note.kind,
    color: note.style?.color ?? 'blue',
    width: note.style?.width ?? 2,
    x: note.region.x,
    y: note.region.y,
    w: note.region.w,
    h: note.region.h,
  };
  if (note.to) mark.to = note.to;
  if (note.points) mark.points = note.points;
  if (note.text) mark.text = note.text;
  if (note.element) mark.element = note.element;
  if (note.kind === 'text' && note.style) Object.assign(mark, pickTextStyle(note.style));
  return mark;
}

/** 标记的锚点（归一化）：序号钮落在这里——画笔是第一个点，别的是起点、左上角或那个点。 */
export function markAnchor(m: Pick<Mark, 'kind' | 'x' | 'y' | 'points'>): Point {
  return (m.kind === 'pen' && m.points?.[0]) || { x: m.x, y: m.y };
}

/** 只留协议认的字段，补上给模型看的 `detail`。 */
function elementForNote(element: VideoAnnotationElement): VideoAnnotationElement {
  const detail = videoAnnotationElementDetail({ ...element, detail: undefined });
  if (element.kind === 'html') {
    const { selector, w, h, name, role, focusable } = element;
    return {
      kind: 'html',
      selector,
      ...(w ? { w } : {}),
      ...(h ? { h } : {}),
      ...(name ? { name } : {}),
      ...(role ? { role } : {}),
      ...(focusable !== undefined ? { focusable } : {}),
      detail,
    };
  }
  return { kind: element.kind, id: element.id, ...(element.text ? { text: element.text } : {}), detail };
}
