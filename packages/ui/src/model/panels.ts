import {
  FOCAL_MAX_ZOOM,
  focalZoom,
  panelLayoutOf,
  panelRects,
  panelUpscale,
  panelWindow,
  type EditOperation,
  type FocalPoint,
  type Id,
  type PanelLayout,
  type PanelRect,
  type SequenceItem,
  type VideoItem,
  type VideoPanel,
} from '@baocut/protocol';
import type { Assets, CanvasSize, Point } from './stage-pose.ts';
import { sourceSize } from './stage-framing.ts';

/**
 * 分屏（短视频分屏设计 §3–§4、§8，原型 model-panels.js；视频格式规范 §3.5 `VideoItem.panels`）：一件全屏铺满的视频画成 2–4 格，
 * 每格同一帧原片按自己的取景点铺满。格子是固定的，改的只是每格的取景点（放大与位置）；版式切换、互换、只留一人、套到整支
 * 都是一次 `setStyle`。版式的格子、格子里看得见原片哪一块、放大量都用 protocol 里与派生同一份的算法。
 */

/** 每一格的放大量（成片一个像素对原片几个像素）超过它就提醒发虚；与派生的 `panel-upscaled` 同一个门槛。 */
export const PANEL_UPSCALE_WARN = 2.5;

export type PanelledVideo = VideoItem & { panels: VideoPanel[] };

export function hasPanels(item: SequenceItem | null | undefined): item is PanelledVideo {
  return !!item && item.type === 'video' && Array.isArray(item.panels) && item.panels.length > 0;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** 一格的像素尺寸。 */
export function cellSize(rect: PanelRect, canvas: CanvasSize): CanvasSize {
  return { width: (canvas.width * rect.w) / 100, height: (canvas.height * rect.h) / 100 };
}

/** 交给格子的源尺寸：源的显示尺寸按实例的裁剪留下的那块（渲染时先裁剪、再按格子取景）；不知道源尺寸时 null。 */
export function panelSource(item: VideoItem, assets: Assets | undefined): CanvasSize | null {
  const size = sourceSize(item, assets);
  if (!size) return null;
  const c = item.crop;
  const w = c ? 1 - c.left - c.right : 1;
  const h = c ? 1 - c.top - c.bottom : 1;
  return w > 0 && h > 0 ? { width: size.width * w, height: size.height * h } : null;
}

/** 取景点规整：位置夹在 [0, 1] 取四位小数，放大夹在 [1, 上限] 取三位，1 不写。 */
function cleanFocal(f: { x: number; y: number; zoom?: number }): FocalPoint {
  const zoom = round(clamp(Number.isFinite(f.zoom) ? f.zoom! : 1, 1, FOCAL_MAX_ZOOM), 3);
  const x = round(clamp(Number.isFinite(f.x) ? f.x : 0.5, 0, 1), 4);
  const y = round(clamp(Number.isFinite(f.y) ? f.y : 0.5, 0, 1), 4);
  return zoom === 1 ? { x, y } : { x, y, zoom };
}

/** 一人改分屏的默认格子：两格上下，上格取原片左半、下格取右半，放大 1.4（之后在格子里调）。 */
export function defaultPanels(): VideoPanel[] {
  return panelRects('rows', 2)!.map((rect, i) => ({ rect, focalPoint: { x: i ? 0.75 : 0.25, y: 0.4, zoom: 1.4 } }));
}

/** 互换两格的人：格子不动，取景点对调。 */
export function swapPanels(panels: readonly VideoPanel[], a = 0, b = 1): VideoPanel[] {
  const pa = panels[a];
  const pb = panels[b];
  if (!pa || !pb) return [...panels];
  return panels.map((p, i) =>
    i === a ? { rect: p.rect, focalPoint: pb.focalPoint } : i === b ? { rect: p.rect, focalPoint: pa.focalPoint } : p,
  );
}

/** 改一格的取景（放大与位置，缺的沿用）。 */
export function withPanelFocal(panels: readonly VideoPanel[], index: number, patch: Partial<FocalPoint>): VideoPanel[] {
  return panels.map((p, i) =>
    i === index ? { rect: p.rect, focalPoint: cleanFocal({ ...p.focalPoint, zoom: focalZoom(p.focalPoint), ...patch }) } : p,
  );
}

/** 把一段的格子取景套到另一段：格数相同才套（格子不动、各格的取景点照搬），否则 null。 */
export function applyPanelsTo(from: readonly VideoPanel[], to: readonly VideoPanel[]): VideoPanel[] | null {
  if (from.length !== to.length) return null;
  return to.map((p, i) => ({ rect: p.rect, focalPoint: { ...from[i]!.focalPoint } }));
}

/**
 * 只留这一格的人：换成整幅一人的取景点，这个人仍落在原片里原来的横向位置（整幅的窗口中心对准这一格窗口的中心），不放大。
 */
export function soloFocal(panel: VideoPanel, source: CanvasSize, canvas: CanvasSize): FocalPoint {
  const w = panelWindow(panel.focalPoint, source, cellSize(panel.rect, canvas));
  const whole = panelWindow({ x: 0.5, y: 0.5 }, source, canvas);
  const at = (center: number, kept: number) => (kept < 1 - 1e-9 ? clamp(center - kept / 2, 0, 1 - kept) / (1 - kept) : 0.5);
  return cleanFocal({ x: at(w.left + w.width / 2, whole.width), y: 0.5 });
}

/** 画布上的一点落在哪一格；不在任何一格里时 -1。 */
export function panelAt(panels: readonly VideoPanel[], p: Point, canvas: CanvasSize): number {
  const x = (p.x / canvas.width) * 100;
  const y = (p.y / canvas.height) * 100;
  return panels.findIndex(({ rect }) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h);
}

/**
 * 在一格里拖（画布像素的位移）：画面跟着手走，即这一格看得见的窗口反方向挪；碰到原片边缘就停（`edge` 为 true）。
 * 这一格在那个方向上没有多出来的画面时不动。
 */
export function panPanel(
  panels: readonly VideoPanel[],
  index: number,
  delta: Point,
  source: CanvasSize,
  canvas: CanvasSize,
): { panels: VideoPanel[]; edge: boolean } {
  const panel = panels[index];
  if (!panel) return { panels: [...panels], edge: false };
  const cell = cellSize(panel.rect, canvas);
  const w = panelWindow(panel.focalPoint, source, cell);
  let edge = false;
  const along = (start: number, kept: number, move: number, size: number, focal: number) => {
    if (kept >= 1 - 1e-9 || !(size > 0)) return focal;
    const want = (start - (move / size) * kept) / (1 - kept);
    const next = clamp(want, 0, 1);
    if (Math.abs(want - next) > 1e-4) edge = true;
    return next;
  };
  const x = along(w.left, w.width, delta.x, cell.width, panel.focalPoint.x);
  const y = along(w.top, w.height, delta.y, cell.height, panel.focalPoint.y);
  return { panels: withPanelFocal(panels, index, { x, y }), edge };
}

/** 每格放得太大的（放大量超过门槛）；不知道源尺寸时全 false。 */
export function upscaledPanels(panels: readonly VideoPanel[], source: CanvasSize | null, canvas: CanvasSize): boolean[] {
  return panels.map((p) => !!source && panelUpscale(p, source, canvas) > PANEL_UPSCALE_WARN);
}

/** 这组格子的版式；认不出（格子被别处改过）时 null。 */
export const layoutOfPanels = (panels: readonly VideoPanel[]): PanelLayout | null => panelLayoutOf(panels);

const samePanels = (a: readonly VideoPanel[] | undefined, b: readonly VideoPanel[] | null) =>
  JSON.stringify(a ?? null) === JSON.stringify(b && b.length ? b : null);

/** 写一件视频的格子（`null` 去掉，回到一人），可以顺带写一人的取景点；什么都没变时空表。 */
export function panelsOperations(
  sequenceId: Id,
  item: SequenceItem,
  panels: readonly VideoPanel[] | null,
  focalPoint?: FocalPoint,
): EditOperation[] {
  if (item.type !== 'video') return [];
  const next = panels && panels.length ? panels.map((p) => ({ rect: { ...p.rect }, focalPoint: { ...p.focalPoint } })) : null;
  const focal =
    focalPoint && JSON.stringify(focalPoint) !== JSON.stringify(item.focalPoint ?? null) ? { focalPoint: { ...focalPoint } } : {};
  if (samePanels(item.panels, next) && !('focalPoint' in focal)) return [];
  return [{ type: 'setStyle', sequenceId, itemId: item.id, panels: next, ...focal }];
}

/** 一人 → 分屏（默认两格）。已经分屏的空表。 */
export function splitOperations(sequenceId: Id, item: VideoItem): EditOperation[] {
  return hasPanels(item) ? [] : panelsOperations(sequenceId, item, defaultPanels());
}

/**
 * 分屏 → 一人：去掉格子，回到实例原来的取景点；派生出来的分屏段没有自己的取景点，就按上面那一格的人对准（同「只留这一格」）。
 */
export function singleOperations(sequenceId: Id, item: PanelledVideo, source: CanvasSize | null, canvas: CanvasSize): EditOperation[] {
  const focal = item.focalPoint ?? (source ? soloFocal(item.panels[0]!, source, canvas) : undefined);
  return panelsOperations(sequenceId, item, null, focal);
}

/** 只留这一格的人：去掉格子，换成整幅一人的取景点（不知道源尺寸时居中）。 */
export function soloOperations(
  sequenceId: Id,
  item: PanelledVideo,
  index: number,
  source: CanvasSize | null,
  canvas: CanvasSize,
): EditOperation[] {
  const panel = item.panels[index];
  if (!panel) return [];
  return panelsOperations(sequenceId, item, null, source ? soloFocal(panel, source, canvas) : { x: 0.5, y: 0.5 });
}

/** 套到整支：把这一段各格的取景点写到同一素材的其它分屏段，格数相同的才套，一人段不动；一笔事务。 */
export function applyPanelsToAll(
  sequenceId: Id,
  item: PanelledVideo,
  pieces: readonly SequenceItem[],
): { operations: EditOperation[]; count: number } {
  const targets = pieces.filter(
    (piece): piece is PanelledVideo => piece.id !== item.id && hasPanels(piece) && piece.panels.length === item.panels.length,
  );
  return {
    operations: targets.flatMap((piece) => panelsOperations(sequenceId, piece, applyPanelsTo(item.panels, piece.panels))),
    count: targets.length,
  };
}
