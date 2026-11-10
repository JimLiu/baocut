import { APPLIED_ASSET_REF, type PackSticker } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { ToastQueue } from '@react-spectrum/s2';
import { frameAt, rootSequence } from '../../model/editor.ts';
import { LOTTIE_SECONDS } from '../../model/library-brand.ts';
import { insertVisual, spanAtPlayhead } from '../../model/new-items.ts';
import { STICKER_PACK_COPY as SP } from '../../model/sticker-pack-copy.ts';
import { HOST_SECONDS, packStickerLayer, packStickerName } from '../../model/sticker-packs.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { applySticker } from '../../runtime/sticker-commands.ts';
import { transactionLabel } from '../../runtime/video-controller.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { useFinishInsert } from './use-insert-visual.ts';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';

/**
 * 随包贴纸放进这个视频：`stickers.applyToVideo` 把文件拷进视频，同一笔事务里在播放头处新建一层贴纸画它
 * （`assetImportRef` 指向拷进来的那份），一步撤销。拷进来的那一份可以分色改，与应用里的那份无关。内置主播也走这一条：
 * 拷进来的是角色包，第一次用的角色要先从素材 CDN 下载。
 */
export function usePackSticker(): (sticker: PackSticker) => Promise<void> {
  const runtime = useRuntime();
  const finish = useFinishInsert();
  return async (sticker) => {
    // 跟着拷贝提交的新建按此刻的视频算：先等编辑器队列里的修改都落下。
    await runtime.videos.settled();
    const video = useVideo.getState().video;
    const snapshot = video?.state?.video;
    const sequence = snapshot ? rootSequence(snapshot) : null;
    if (!video?.videoId || !canEdit(video) || !snapshot || !sequence) return;
    const name = packStickerName(sticker);
    const frame = frameAt(useEditor.getState().playhead, sequence.fps);
    const request = { span: spanAtPlayhead(sequence, frame, sticker.host ? HOST_SECONDS : LOTTIE_SECONDS), label: name };
    const layers = [packStickerLayer(sticker, { assetImportRef: APPLIED_ASSET_REF }, sequence.canvas)];
    try {
      const result = await applySticker(runtime, {
        videoId: video.videoId,
        id: sticker.id,
        name,
        expectedRevision: snapshot.revision,
        operations: insertVisual(sequence, request.span, layers, EL.elementsTrack),
        ...transactionLabel(EditLabel.addNamed({ name })),
      });
      finish(sequence, request, result.receipt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ToastQueue.negative(sticker.host ? SP.hostAddFailed(message) : SP.addFailed(message), { timeout: 6000 });
    }
  };
}
