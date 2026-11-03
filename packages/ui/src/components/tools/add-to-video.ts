import { newId, type AssetRecord, type FileTarget, type Id, type Sequence, type TransactionReceipt } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import type { AddToMoviePlan } from '../../model/tool-outputs.ts';
import type { BackgroundUndoDeps } from '../thread/change-undo.ts';
import { transactionLabel } from '../../runtime/video-controller.ts';

export interface AddedToVideo extends Pick<AddToMoviePlan, 'placed' | 'bed' | 'onTimeline'> {
  videoId: Id;
  transactionId: TransactionReceipt['transactionId'];
  /** 这一笔真的改了什么。同样的 bytes 已在视频里时引擎复用原素材，这一笔是空的，也没有可撤销的。 */
  changed: boolean;
}

/**
 * 工具结果的「加到视频」（产品设计 §2.7）：选中的视频不必在编辑器里开着，在后台打开、提交一笔普通的编辑再关掉
 * （同 thread/change-undo.ts）；版本检查与保护照常，被拒时原样抛给调用方。编辑器占着这部视频时不替它关，改动经订阅显示在那边。
 * 这一笔要几个操作看视频眼下的样子（时间线空不空、音乐铺过没有），由 `plan` 按刚打开的快照给。
 */
export async function addFileToVideo(
  deps: BackgroundUndoDeps,
  target: FileTarget,
  plan: (sequence: Sequence, assets: Record<Id, AssetRecord>) => AddToMoviePlan,
): Promise<AddedToVideo> {
  const { ref, snapshot } = await deps.request('videos.open', target);
  try {
    const video = snapshot.video;
    const sequence = video.sequences[video.rootSequenceId];
    if (!sequence) throw new Error(`Video ${ref.videoId} has no root sequence`);
    const planned = plan(sequence, video.assets);
    const { receipt } = await deps.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: video.revision,
      operations: planned.operations,
      ...transactionLabel(planned.bed ? EditLabel.addSoundtrack() : EditLabel.importAssets()),
    });
    const changed = receipt.createdIds.length + receipt.updatedIds.length + receipt.deletedIds.length > 0;
    return { videoId: ref.videoId, transactionId: receipt.transactionId, placed: planned.placed, bed: planned.bed, onTimeline: planned.onTimeline, changed };
  } finally {
    if (!deps.editorHolds(target, ref.videoId)) await deps.request('videos.close', { videoId: ref.videoId }).catch(() => {});
  }
}
