import {
  FOCAL_MAX_ZOOM,
  focalZoom,
  videoDisplaySize,
  type Crop,
  type EditOperation,
  type FocalPoint,
  type Id,
  type SequenceItem,
  type VideoItem,
  type VisualMode,
} from '@baocut/protocol';
import type { PanelledVideo } from './panels.ts';
import { placeFields, poseOf, type Assets, type CanvasSize, type PlaceFields, type PlacedItem, type Point, type Pose } from './stage-pose.ts';

/**
 * 按原片取景（产品设计 §5.10「画面怎么取景」，原型 model-framing.js 与 stage-framing.jsx）：铺满画面、`cover`、带取景点的视频。
 * 剪成短视频时每段原片都这样摆：取景点是剪的时候按画面里的人找到的位置，按镜头分段时每段各有一份；换画幅时按新画幅重新对准，
 * 画面始终铺满。所以画布上只能围着取景点放大、缩小（`focalPoint.zoom`，视频格式规范 §3.5），不能拖动、留边、拉伸或旋转；
 * 要自己摆就明确地「改成自由摆放」。旧的短视频只带裁剪、没有取景点，按居中的取景点看（看到的一样）。
 * 分屏的片段（`panels`，见 `panels.ts`）也算：选中框是整块画布，放大与位置在各格里改，实例自己的取景点不参与。
 */

export type FramedVideo = VideoItem;

export function isFramed(item: SequenceItem): item is FramedVideo {
  return (
    item.type === 'video' &&
    item.mode === 'fullscreen' &&
    (item.fit ?? 'cover') === 'cover' &&
    !!(item.crop || item.focalPoint || item.panels?.length)
  );
}

/** 分屏的片段：按原片取景、带格子。 */
export const isPanelled = (item: SequenceItem): item is PanelledVideo => isFramed(item) && !!item.panels?.length;

/** 源的显示尺寸（已按旋转交换，乘上像素宽高比；与 `render-graph` 的 `display_size` 同口径）；素材表里没有时 null。 */
export function sourceSize(item: VideoItem, assets: Assets | undefined): { width: number; height: number } | null {
  return videoDisplaySize(assets?.[item.assetRef.id]?.revisions[item.assetRef.revision]);
}

/** 视频的取景：裁剪与取景点（视频格式规范 §3.5），没有的是 null。 */
export interface ItemFraming {
  crop: Crop | null;
  focalPoint: FocalPoint | null;
}

export const framingOf = (item: VideoItem): ItemFraming => ({ crop: item.crop ?? null, focalPoint: item.focalPoint ?? null });

/** 缩过头、放过头多少倍才说一句（手上的抖动不该一直弹）；拖画面本身是 `locked`，在分屏的一格里拖到原片边上是 `edge`。 */
const SLACK = 0.03;
export type FramingHit = 'locked' | 'min' | 'max' | 'edge';

/**
 * 铺满画布的盒随 `rot` 与镜像绕画布中心转、翻（帧计划里铺满的视频就是画布那么大的框）：画布上的点 → 画面上看到的位置。
 */
function onScreen(item: PlacedItem, canvas: CanvasSize, p: Point): Point {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const x = item.place.flipX ? 2 * cx - p.x : p.x;
  const y = item.place.flipY ? 2 * cy - p.y : p.y;
  const a = ((item.place.rot ?? 0) * Math.PI) / 180;
  if (!a) return { x, y };
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: cx + (x - cx) * cos - (y - cy) * sin, y: cy + (x - cx) * sin + (y - cy) * cos };
}

/** 取景点落在画面上的那一点（画布像素）：原片上取景点那一点永远落在画面的同一比例处，放大围着它，准星也画在这里。 */
export function framingAnchor(item: FramedVideo, canvas: CanvasSize): Point {
  const f = item.focalPoint;
  return onScreen(item, canvas, { x: (f?.x ?? 0.5) * canvas.width, y: (f?.y ?? 0.5) * canvas.height });
}

/**
 * 画布上的盒：整幅原片（裁剪留下的那块）按 `cover` 铺满再乘放大倍数，多出来的按取景点分到两边（`picturePose`）。
 * 选中框和四角落在原片的边上，可以超出画面。不知道源尺寸时 null。
 */
export function framedPose(item: FramedVideo, canvas: CanvasSize, assets: Assets | undefined): Pose | null {
  if (item.panels?.length) return { cx: canvas.width / 2, cy: canvas.height / 2, w: canvas.width, h: canvas.height, rotation: 0 };
  return sourceSize(item, assets) ? picturePose(item, canvas, assets) : null;
}

/**
 * 铺满画布、可以在画布上直接拖成自由摆放的：铺满模式的视觉媒体（视频、图片、素材贴纸、白板），按原片取景的除外（只能放大）。
 * 占位框的框高不跟源走，合成没有 `mode`（不写位置与宽才铺满），都不在这里换。
 */
export function fillsCanvas(item: SequenceItem): item is PlacedItem {
  const media = item.type === 'video' || item.type === 'image' || item.type === 'sticker' || item.type === 'whiteboard';
  return media && item.mode === 'fullscreen' && !isFramed(item);
}

/**
 * 铺满画布的媒体此刻在画面上的那一幅：整幅源（裁剪留下的那块）按 `fit` 铺满（`cover`，乘上取景点的放大倍数，多出来的
 * 按取景点分到两边）或放进（`contain`，居中）画布，与 `render-graph` 的 `media_layer` 同口径。源的宽高比按画中画摆出来的框量
 * （同一份帧计划推法；不知道源尺寸时按画布的，于是就是整块画布）。
 */
function picturePose(item: PlacedItem, canvas: CanvasSize, assets: Assets | undefined): Pose | null {
  if (!(canvas.width > 0) || !(canvas.height > 0) || !('fit' in item)) return null;
  const natural = poseOf({ ...item, mode: 'pip', place: { x: 50, y: 50, w: 100 } } as PlacedItem, canvas, assets);
  const ratio = natural.h / natural.w;
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null;
  const cover = (item.fit ?? 'cover') === 'cover';
  const focal = cover && (item.type === 'video' || item.type === 'image') ? item.focalPoint : undefined;
  const fill = cover ? Math.max(canvas.width, canvas.height / ratio) : Math.min(canvas.width, canvas.height / ratio);
  const w = fill * focalZoom(focal);
  const h = w * ratio;
  const fx = focal?.x ?? 0.5;
  const fy = focal?.y ?? 0.5;
  const center = onScreen(item, canvas, { x: (canvas.width - w) * fx + w / 2, y: (canvas.height - h) * fy + h / 2 });
  return { cx: center.x, cy: center.y, w, h, rotation: item.place.rot ?? 0 };
}

/** 换放大倍数：取景点与裁剪不动（旧的只带裁剪的视频补一个居中的取景点，看到的一样），夹在 [1, 上限]，取三位小数，1 不写。 */
export function withZoom(item: FramedVideo, zoom: number): ItemFraming {
  const z = Math.round(Math.min(FOCAL_MAX_ZOOM, Math.max(1, Number.isFinite(zoom) ? zoom : 1)) * 1000) / 1000;
  const x = item.focalPoint?.x ?? 0.5;
  const y = item.focalPoint?.y ?? 0.5;
  return { crop: item.crop ?? null, focalPoint: z === 1 ? { x, y } : { x, y, zoom: z } };
}

/**
 * 拖角缩放（画布像素）：起手的放大倍数 × 指针到取景点落点的距离比，于是那一点在画面上不动、角柄一直跟着手。
 * 想缩到比铺满还小时 `hit` 为 `min`，超过上限时为 `max`。
 */
export function zoomFraming(item: FramedVideo, anchor: Point, p0: Point, p: Point): { framing: ItemFraming; hit: FramingHit | null } {
  const d0 = Math.hypot(p0.x - anchor.x, p0.y - anchor.y);
  const start = focalZoom(item.focalPoint);
  const want = d0 > 1e-6 ? (start * Math.hypot(p.x - anchor.x, p.y - anchor.y)) / d0 : start;
  return { framing: withZoom(item, want), hit: want < 1 - SLACK ? 'min' : want > FOCAL_MAX_ZOOM + SLACK ? 'max' : null };
}

const sameCrop = (a: Crop | undefined, b: Crop | null) =>
  a && b ? a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom : !a && !b;
/** 没有取景点就是居中、不放大（渲染器的缺省）：旧的只带裁剪的视频缩回 100% 时不该多出一笔什么都没变的修改。 */
const CENTER: FocalPoint = { x: 0.5, y: 0.5 };
const sameFocal = (a: FocalPoint | undefined, b: FocalPoint | null) => {
  const p = a ?? CENTER;
  const q = b ?? CENTER;
  return p.x === q.x && p.y === q.y && focalZoom(p) === focalZoom(q);
};

/** 把取景写进一件视频：只写变了的裁剪与取景点（null 去掉）；都一样时是空表（不提交）。 */
export function framingOperations(sequenceId: Id, item: SequenceItem, framing: ItemFraming): EditOperation[] {
  if (item.type !== 'video') return [];
  const crop = sameCrop(item.crop, framing.crop) ? {} : { crop: framing.crop ? { ...framing.crop } : null };
  const focal = sameFocal(item.focalPoint, framing.focalPoint) ? {} : { focalPoint: framing.focalPoint ? { ...framing.focalPoint } : null };
  if (!('crop' in crop) && !('focalPoint' in focal)) return [];
  return [{ type: 'setStyle', sequenceId, itemId: item.id, ...crop, ...focal }];
}

/** 「填满画布」：放大回 100%。已经是 100% 的、分屏的（格子恒铺满，放大在各格里）空表。 */
export function fillFramingOperations(sequenceId: Id, item: FramedVideo): EditOperation[] {
  return item.panels?.length || focalZoom(item.focalPoint) === 1 ? [] : framingOperations(sequenceId, item, withZoom(item, 1));
}

/**
 * 改成自由摆放：换成画中画，盒就是此刻画面上那幅原片（切换的那一下画面不动），去掉取景点；裁剪留着（框按留下的那块的宽高比）。
 * 之后换画幅时这一段不再自动对准。一笔事务；不知道源尺寸时空表。
 */
export function freeFramingOperations(sequenceId: Id, item: FramedVideo, canvas: CanvasSize, assets: Assets | undefined): EditOperation[] {
  // 分屏的出口是属性面板「版式」里换回一人：换成画中画会连格子一起去掉。
  if (item.panels?.length) return [];
  const pose = framedPose(item, canvas, assets);
  if (!pose) return [];
  const { focalPoint: _focal, ...rest } = item;
  const pip: VideoItem = { ...rest, mode: 'pip' };
  const fields = placeFields(pip, pose, canvas, assets);
  return [
    { type: 'setStyle', sequenceId, itemId: item.id, mode: 'pip', focalPoint: null },
    ...(Object.keys(fields).length ? [{ type: 'setTransform' as const, sequenceId, itemId: item.id, ...fields }] : []),
  ];
}

/** 选中框用的盒：按原片取景的视频是整幅原片，铺满画布的媒体是画面上那一幅，其余照帧计划的框。 */
export function stagePose(item: PlacedItem, canvas: CanvasSize, assets: Assets | undefined): Pose {
  const picture = isFramed(item) ? framedPose(item, canvas, assets) : fillsCanvas(item) ? picturePose(item, canvas, assets) : null;
  return picture ?? poseOf(item, canvas, assets);
}

/** 盒写回时的改动：`mode` 是要不要先换成画中画，`place` 是要写的字段（与此刻相同的不写）。 */
export interface PlaceChange {
  mode?: VisualMode;
  place: PlaceFields;
}

const BOX_FIELDS = ['x', 'y', 'w', 'scaleY'] as const;

/**
 * 盒 → 写回的改动（舞台手势、方向键、属性页几何、对齐与工具条共用）。铺满画布的媒体（`fillsCanvas`）挪了位置或改了大小，
 * 就像其它素材一样自由摆放（产品设计 §5.10）：换成画中画，框就是给的盒，起手的盒是画面上那一幅，所以切换那一下画面不动；
 * 只转了角度的照旧铺满。其余照 `placeFields`。
 */
export function placeChange(
  item: PlacedItem,
  pose: Pose,
  canvas: CanvasSize,
  assets: Assets | undefined,
  textHeight?: number,
): PlaceChange {
  if (fillsCanvas(item)) {
    const pip = { ...item, mode: 'pip' } as PlacedItem;
    const place = placeFields(pip, pose, canvas, assets);
    const still = placeFields(pip, stagePose(item, canvas, assets), canvas, assets);
    if (BOX_FIELDS.some((key) => place[key] !== still[key])) return { mode: 'pip', place };
  }
  return { place: placeFields(item, pose, canvas, assets, textHeight) };
}

/** `placeChange` 的操作：先换模式、再写 `place`，一笔事务；什么都没变是空表。 */
export function placeOperations(sequenceId: Id, item: PlacedItem, pose: Pose, canvas: CanvasSize, assets: Assets | undefined): EditOperation[] {
  const { mode, place } = placeChange(item, pose, canvas, assets);
  return [
    ...(mode ? [{ type: 'setStyle' as const, sequenceId, itemId: item.id, mode }] : []),
    ...(Object.keys(place).length ? [{ type: 'setTransform' as const, sequenceId, itemId: item.id, ...place }] : []),
  ];
}
