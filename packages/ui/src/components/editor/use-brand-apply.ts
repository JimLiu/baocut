import type { BrandContent, LibraryApplyResult, LibraryEntry, Sequence } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { frameAt, rootSequence } from '../../model/editor.ts';
import { isPlaceable, placeAsset } from '../../model/editor-ops.ts';
import { LOTTIE_SECONDS, brandPlacement, captionStyleTargets, lottieLayer } from '../../model/library-brand.ts';
import { libraryErrorText } from '../../model/library-entry.ts';
import { spanAtPlayhead } from '../../model/new-items.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { applyLibraryEntry, waitForAsset } from '../../runtime/library-commands.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { useInsertVisual } from './use-insert-visual.ts';
import { BRAND_COPY as IB } from './brand-copy.ts';

function currentSequence(): Sequence | null {
  const snapshot = useVideo.getState().video?.state?.video;
  return snapshot ? rootSequence(snapshot) : null;
}

/**
 * 品牌条目放进这个视频（架构设计 §5.9）：先用 `library.applyToVideo` 拷进视频（一笔编辑，之后库里的修改不影响视频），
 * 再按种类放：图片、视频与图片贴纸放到播放头处的时间线上，Lottie 贴纸用内置播放器新建一层，字体只进素材库；
 * 字幕样式在同一笔里让这个视频的字幕都用它。
 */
export function useBrandApply(): (entry: LibraryEntry) => Promise<void> {
  const runtime = useRuntime();
  const { apply } = useEditorActions();
  const insert = useInsertVisual();
  return async (entry) => {
    const video = useVideo.getState().video;
    const sequence = currentSequence();
    if (!video?.videoId || !canEdit(video) || !sequence) return;
    const content = entry.content as BrandContent;
    const targets = content.kind === 'captionStyle' ? captionStyleTargets(sequence) : [];
    let result: LibraryApplyResult;
    try {
      result = await applyLibraryEntry(runtime, {
        videoId: video.videoId,
        entry: { library: 'brand', id: entry.id, version: entry.version },
        ...(targets.length ? { sequenceId: sequence.id, captionItemIds: targets } : {}),
      });
    } catch (error) {
      ToastQueue.negative(libraryErrorText(IB.actionPlace(content.name), error), { timeout: 6000 });
      return;
    }

    if (content.kind === 'captionStyle') {
      ToastQueue.positive(
        targets.length ? IB.appliedToCaptions(content.name, targets.length) : IB.copiedNoCaptions(content.name),
        { timeout: 4000 },
      );
      return;
    }
    const placement = brandPlacement(content);
    if (placement === 'import-only' || !result.assetId) {
      ToastQueue.positive(IB.copiedToAssets(content.name), { timeout: 4000 });
      return;
    }
    const asset = await waitForAsset(result.assetId);
    const fresh = currentSequence();
    if (!asset || !fresh) {
      ToastQueue.neutral(IB.copiedNotPlaced(content.name), { timeout: 5000 });
      return;
    }
    const frame = frameAt(useEditor.getState().playhead, fresh.fps);
    if (placement === 'lottie') {
      await insert(fresh, {
        span: spanAtPlayhead(fresh, frame, LOTTIE_SECONDS),
        layers: [lottieLayer(content.name, asset, fresh.canvas)],
        label: content.name,
        trackName: IB.elementsTrack,
      });
      return;
    }
    if (!isPlaceable(asset)) {
      ToastQueue.neutral(IB.copiedNotPlaceable(content.name), { timeout: 5000 });
      return;
    }
    const receipt = await apply(placeAsset(fresh, asset, frame), IB.addLabel(content.name));
    if (receipt) ToastQueue.positive(IB.placedAtPlayhead(content.name), { timeout: 4000 });
  };
}
