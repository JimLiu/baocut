import { focalZoom, framesToSeconds, type EditOperation, type Id, type Sequence, type SequenceItem } from '@baocut/protocol';
import { framingOperations, isFramed, withZoom, type FramedVideo } from './stage-framing.ts';

/**
 * 按镜头分段取景（产品设计 §5.10「改一支短视频」，原型 model-shorts-cut.js 的 `shotBadge` 与 stage-framing.jsx 的 `FramingChip`）：
 * 剪成短视频时按镜头取景的子视频里，主素材按镜头拆成几段视频，各带自己的取景点（`videos_derive` 写的，对准各自的人）。
 * 画布上选中其中一段时，按原片取景的小牌上多写一句是哪一段；「套到整支」只把这一段的放大倍数写到同一素材的每一段，
 * 各段的取景点不动。
 */

/** 和 `item` 一起分段取景的那几段：同一素材、按原片取景的视频，按时间线先后排。`item` 本身不是这种视频时空表。 */
export function framingPieces(sequence: Sequence, item: SequenceItem): FramedVideo[] {
  if (!isFramed(item)) return [];
  const asset = item.assetRef.id;
  return sequence.items
    .filter((other): other is FramedVideo => isFramed(other) && other.assetRef.id === asset)
    .sort((a, b) => a.span.fromFrame - b.span.fromFrame);
}

/** 小牌上写不写段号、给不给「套到整支」：这支视频的主素材拆成了不止一段取景，选中的是其中一段。 */
export function showsShotChip(sequence: Sequence, item: SequenceItem): boolean {
  const pieces = framingPieces(sequence, item);
  return pieces.length > 1 && pieces.some((piece) => piece.id === item.id);
}

/** 小牌上的秒：这一段在子视频时间线上的起止，取整，止至少比起多 1 秒（原型 `shotBadge`）。 */
export function shotSeconds(item: FramedVideo, sequence: Pick<Sequence, 'fps'>): { from: number; to: number } {
  const from = Math.round(framesToSeconds(item.span.fromFrame, sequence.fps));
  const to = Math.max(from + 1, Math.round(framesToSeconds(item.span.fromFrame + item.span.durationFrames, sequence.fps)));
  return { from, to };
}

/**
 * 「套到整支」：把 `item` 现在的放大倍数写到同一素材的其它几段（一笔事务），各段的取景点与裁剪不动；已经一样的不写。
 * 分屏段的放大在各格里（`panels.ts` 的 `applyPanelsToAll`），这里跳过。
 */
export function applyFramingToAll(sequenceId: Id, item: FramedVideo, pieces: readonly FramedVideo[]): EditOperation[] {
  const zoom = focalZoom(item.focalPoint);
  return pieces
    .filter((piece) => piece.id !== item.id && !piece.panels?.length && focalZoom(piece.focalPoint) !== zoom)
    .flatMap((piece) => framingOperations(sequenceId, piece, withZoom(piece, zoom)));
}
