import type { EditOperation, Id } from '@baocut/protocol';
import { asObject, num } from '../render/text-style.ts';
import type { ItemPatch } from './item-draft.ts';
import { editableTextStyle, patchTextStyle } from './property-values.ts';
import { round1 } from './geometry-panel.ts';
import {
  GUIDE_TOL,
  SNAP_PX,
  boxRect,
  cornerScale,
  dragMove,
  dragRotation,
  edgeResize,
  groupScale,
  groupShift,
  guidesFor,
  moveLimits,
  placeFields,
  poseOf,
  sizeRange,
  type Assets,
  type CanvasSize,
  type Guide,
  type Handle,
  type Limits,
  type PlacedItem,
  type Point,
  type Pose,
  type Rect,
} from './stage-pose.ts';

/**
 * 舞台上的一次手势（原型 stage-objects.jsx 的 `gesture` 与 stage-marquee.jsx 的 MultiBox）：起手冻住每件的盒，
 * 指针每动一下按同一份起手状态算出这一刻的盒（不累积误差），松手把盒换回 `place`、生成一笔事务的操作。
 * 全是序列画布像素；屏幕上的阈值由调用方给出「一个屏幕像素合多少画布像素」（`pxScale`）。
 */

/** 参与手势的一件：实例、起手时的盒、移动限位，以及推盒用的素材表（媒体的框高按源的宽高比）。 */
export interface Member {
  item: PlacedItem;
  start: Pose;
  limits: Limits;
  assets?: Assets;
}

export type Gesture =
  | { kind: 'move'; member: Member; p0: Point }
  | { kind: 'edge'; member: Member; handle: Handle; p0: Point }
  | { kind: 'corner'; member: Member; handle: Handle; p0: Point }
  | { kind: 'rotate'; member: Member; pivot: Point; p0: Point }
  | { kind: 'group-move'; members: Member[]; p0: Point }
  | { kind: 'group-scale'; members: Member[]; bounds: Rect; p0: Point };

export interface Modifiers {
  shift: boolean;
  alt: boolean;
}

/** 手势所在的画布：尺寸、参与吸附的其它对象（未旋转的盒）、一个屏幕像素合多少画布像素。 */
export interface StageEnv {
  canvas: CanvasSize;
  others: Rect[];
  pxScale: number;
}

/** 这一刻的结果：每件的盒（与成员同序）、等比倍率（文字连字号一起放大用）、参考线。 */
export interface GestureFrame {
  poses: Pose[];
  factor: number;
  guides: Guide[];
}

export function memberOf(item: PlacedItem, canvas: CanvasSize, assets?: Assets): Member {
  const start = poseOf(item, canvas, assets);
  return { item, start, limits: moveLimits(item, start, canvas), ...(assets ? { assets } : {}) };
}

export function membersOf(gesture: Gesture): Member[] {
  return 'members' in gesture ? gesture.members : [gesture.member];
}

/** 指针到了 `p`（画布像素）：按起手状态算这一刻。⌥ 关吸附；旋转 ⇧ / ⌥ 自由。 */
export function stepGesture(gesture: Gesture, p: Point, mods: Modifiers, env: StageEnv): GestureFrame {
  const { canvas, others, pxScale } = env;
  const dx = p.x - gesture.p0.x;
  const dy = p.y - gesture.p0.y;
  const guidesOf = (pose: Pose) => guidesFor(boxRect(pose), canvas, others, GUIDE_TOL * pxScale);
  switch (gesture.kind) {
    case 'move': {
      const { start, limits } = gesture.member;
      const snap = mods.alt ? null : { canvas, others, threshold: SNAP_PX * pxScale };
      const pose = dragMove(start, dx, dy, limits, snap);
      return { poses: [pose], factor: 1, guides: guidesOf(pose) };
    }
    case 'edge': {
      const pose = edgeResize({
        handle: gesture.handle,
        dx,
        dy,
        start: gesture.member.start,
        alt: mods.alt,
        shift: mods.shift,
        ratio: null,
        range: sizeRange(canvas),
      });
      return { poses: [pose], factor: 1, guides: guidesOf(pose) };
    }
    case 'corner': {
      const { pose, factor } = cornerScale(gesture.member.start, gesture.handle, gesture.p0, p, mods.alt);
      return { poses: [pose], factor, guides: guidesOf(pose) };
    }
    case 'rotate': {
      const { start } = gesture.member;
      const rotation = dragRotation(start.rotation, gesture.pivot, gesture.p0, p, mods.shift || mods.alt);
      // 元素模型绕框中心转：中心与大小不动，只换角度。
      return { poses: [{ ...start, rotation }], factor: 1, guides: [] };
    }
    case 'group-move': {
      const starts = gesture.members.map((m) => m.start);
      const d = groupShift(
        starts,
        gesture.members.map((m) => m.limits),
        dx,
        dy,
      );
      return { poses: starts.map((s) => ({ ...s, cx: s.cx + d.x, cy: s.cy + d.y })), factor: 1, guides: [] };
    }
    case 'group-scale': {
      const { poses, factor } = groupScale(
        gesture.members.map((m) => m.start),
        gesture.bounds,
        gesture.p0,
        p,
      );
      return { poses, factor, guides: [] };
    }
  }
}

/** 等比缩放时文字的字号跟着乘（夹在 1–400，取一位小数）；样式不是旧版文字样式的不动它。 */
export function scaledFontSize(item: PlacedItem, factor: number): number | null {
  if (item.type !== 'text' || factor === 1 || !editableTextStyle(item.style)) return null;
  const size = num(asObject(item.style).fontSize, 30);
  return Math.min(400, Math.max(1, round1(size * factor)));
}

/** 拖动中叠给预览与属性页的草稿。 */
export function gesturePatch(item: PlacedItem, pose: Pose, factor: number, canvas: CanvasSize, assets?: Assets): ItemPatch {
  const fontSize = scaledFontSize(item, factor);
  return {
    place: placeFields(item, pose, canvas, assets),
    ...(fontSize !== null && item.type === 'text' ? { style: patchTextStyle(item.style, { fontSize }) } : {}),
  };
}

/** 松手：每件只写变了的 `place` 字段，文字等比缩放时再改字号；什么都没变就是空表（不提交）。 */
export function gestureOperations(
  sequenceId: Id,
  members: readonly Member[],
  poses: readonly Pose[],
  factor: number,
  canvas: CanvasSize,
): EditOperation[] {
  const operations: EditOperation[] = [];
  members.forEach(({ item, assets }, i) => {
    const pose = poses[i];
    if (!pose) return;
    const changed = placeFields(item, pose, canvas, assets);
    if (Object.keys(changed).length) operations.push({ type: 'setTransform', sequenceId, itemId: item.id, ...changed });
    const fontSize = scaledFontSize(item, factor);
    if (fontSize !== null && item.type === 'text') {
      operations.push({ type: 'setStyle', sequenceId, itemId: item.id, style: patchTextStyle(item.style, { fontSize }) });
    }
  });
  return operations;
}

/** 方向键微调：一组实例平移同一个位移（限位按全组夹），只夹不吸。 */
export function nudgeOperations(
  sequenceId: Id,
  items: readonly PlacedItem[],
  delta: Point,
  canvas: CanvasSize,
  assets?: Assets,
): EditOperation[] {
  const members = items.map((item) => memberOf(item, canvas, assets));
  const d = groupShift(
    members.map((m) => m.start),
    members.map((m) => m.limits),
    delta.x,
    delta.y,
  );
  const poses = members.map(({ start }) => ({ ...start, cx: start.cx + d.x, cy: start.cy + d.y }));
  return gestureOperations(sequenceId, members, poses, 1, canvas);
}

/** 双击旋转钮归零：只改角度（绕中心）。已经是 0° 的不提交。 */
export function resetRotation(sequenceId: Id, item: PlacedItem): EditOperation[] {
  return item.place.rot ? [{ type: 'setTransform', sequenceId, itemId: item.id, rot: 0 }] : [];
}
