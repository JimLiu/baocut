import type { PackSticker } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { frameAt, rootSequence } from '../../model/editor.ts';
import { LOTTIE_SECONDS } from '../../model/library-brand.ts';
import { spanAtPlayhead } from '../../model/new-items.ts';
import { STICKER_PACK_COPY as SP } from '../../model/sticker-pack-copy.ts';
import { packStickerLayer, packStickerName } from '../../model/sticker-packs.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { waitForAsset } from '../../runtime/library-commands.ts';
import { applySticker } from '../../runtime/sticker-commands.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { useInsertVisual } from './use-insert-visual.ts';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';

/**
 * 随包贴纸放进这个视频：先用 `stickers.applyToVideo` 把文件拷进视频（一笔编辑），再在播放头处新建一层贴纸画它
 * （与品牌库的 Lottie 同一条路）。拷进来的那一份可以分色改，与应用里的那份无关。
 */
export function usePackSticker(): (sticker: PackSticker) => Promise<void> {
  const runtime = useRuntime();
  const insert = useInsertVisual();
  return async (sticker) => {
    const video = useVideo.getState().video;
    if (!video?.videoId || !canEdit(video)) return;
    const name = packStickerName(sticker);
    let assetId: string;
    try {
      ({ assetId } = await applySticker(runtime, { videoId: video.videoId, id: sticker.id, name }));
    } catch (error) {
      ToastQueue.negative(SP.addFailed(error instanceof Error ? error.message : String(error)), { timeout: 6000 });
      return;
    }
    const asset = await waitForAsset(assetId);
    const snapshot = useVideo.getState().video?.state?.video;
    const fresh = snapshot ? rootSequence(snapshot) : null;
    if (!asset || !fresh) return;
    const frame = frameAt(useEditor.getState().playhead, fresh.fps);
    await insert(fresh, {
      span: spanAtPlayhead(fresh, frame, LOTTIE_SECONDS),
      layers: [packStickerLayer(sticker, asset)],
      label: name,
      trackName: EL.elementsTrack,
    });
  };
}
