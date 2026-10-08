import type { Id, Sequence, SequenceItem } from '@baocut/protocol';
import type { CaptionHit } from '../render/render-planner.ts';
import type { VisualLayer } from '../render/frame-plan.ts';
import { poseContains, rectsCross, type Point, type Pose, type Rect } from './stage-pose.ts';

/**
 * 舞台命中（原型 stage-marquee.jsx、旧版 stage-hit.logic）：点落在哪一件上、框选框住了哪几件。
 *
 * 点选按帧计划算：每一层的 `matrix` 把单位正方形映到画布像素，求逆就知道点在不在这一层上；按合成顺序从上往下，
 * 第一件盖住这个点的赢。字幕用光栅同源的行框，不能拿整张画布当命中范围。看不见的东西不能被点中，所以只认这一帧计划里有的层。
 */

type Matrix = VisualLayer['matrix'];

/** 画布点映回层的单位正方形；矩阵退化（缩成一条线）时给 null。 */
export function unitPoint(matrix: Matrix, p: Point): Point | null {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const x = p.x - e;
  const y = p.y - f;
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
}

/** 这一层盖住这个点没有（单位正方形的边上算）。 */
export function layerContains(layer: VisualLayer, p: Point): boolean {
  const u = unitPoint(layer.matrix, p);
  return !!u && u.x >= 0 && u.x <= 1 && u.y >= 0 && u.y <= 1;
}

export interface HitOptions {
  /** 这一件不参与点选（例如没选中的主视频）。 */
  skip?: (itemId: Id) => boolean;
  captionHits?: readonly CaptionHit[];
  /**
   * 已选中那几件的布局框：选中框整块都算它（「适应」的视频，画面只占框的一部分，框里的黑边也该能拖）。
   */
  boxes?: ReadonlyMap<Id, Pose>;
  /** 判断点在不在布局框里。 */
  contains?: (pose: Pose, p: Point) => boolean;
}

/** 点选：按合成顺序从上往下找第一件盖住这个点的实例；字幕只认已画出的行框。 */
export function hitAt(layers: readonly VisualLayer[], p: Point, options: HitOptions = {}): Id | null {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i]!;
    if (layer.kind === 'caption') {
      const hit = captionHitAt(options.captionHits ?? [], p, layer.itemId, options.skip);
      if (hit) return hit.itemId;
      continue;
    }
    if (options.skip?.(layer.itemId)) continue;
    if (layerContains(layer, p)) return layer.itemId;
    const box = options.boxes?.get(layer.itemId);
    if (box && options.contains?.(box, p)) return layer.itemId;
  }
  return null;
}

/** 同一字幕组里从最后画的行往前找；没有真实几何时不抢占底层视频。 */
export function captionHitAt(hits: readonly CaptionHit[], p: Point, layerId?: Id, skip?: (id: Id) => boolean): CaptionHit | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i]!;
    if (layerId && hit.layerId !== layerId) continue;
    if (!skip?.(hit.itemId) && hit.w > 0 && hit.h > 0 && poseContains(hit, p)) return hit;
  }
  return null;
}

/** 这一帧画面上的实例（不含字幕），自下而上、不重复。 */
export function visibleItems(layers: readonly VisualLayer[]): Id[] {
  const out: Id[] = [];
  for (const layer of layers) if (layer.kind !== 'caption' && !out.includes(layer.itemId)) out.push(layer.itemId);
  return out;
}

/**
 * 主视频：最下面那条画面轨道上的视频实例，或者角色标成 `a-roll` 的视频。它铺满整幅画面，
 * 任何一个框、任何一次点空白都会碰到它，所以不参与点选、框选与吸附（原型 stage-marquee.jsx §6）。
 */
export function isMainVideo(item: SequenceItem, sequence: Sequence): boolean {
  if (item.type !== 'video') return false;
  if (item.role === 'a-roll') return true;
  let bottom: { id: Id; order: number } | null = null;
  for (const track of sequence.tracks) {
    if (track.kind === 'visual' && (!bottom || track.order < bottom.order)) bottom = track;
  }
  return !!bottom && item.trackId === bottom.id;
}

/** 框选命中：外包盒与框相交（边贴边不算），按传入顺序给出 id。 */
export function marqueeHits(candidates: readonly { id: Id; rect: Rect }[], marquee: Rect): Id[] {
  return candidates.filter((c) => rectsCross(c.rect, marquee)).map((c) => c.id);
}
