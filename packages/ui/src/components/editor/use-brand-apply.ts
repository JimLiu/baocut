import { APPLIED_ASSET_REF, type BrandContent, type LibraryApplyResult, type LibraryEntry, type Sequence } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { ToastQueue } from '@react-spectrum/s2';
import { frameAt, rootSequence } from '../../model/editor.ts';
import { isPlaceable, placeAsset, placeImportedImage } from '../../model/editor-ops.ts';
import { LOTTIE_SECONDS, brandPlacement, captionStyleTargets, lottieLayer } from '../../model/library-brand.ts';
import { libraryErrorText } from '../../model/library-entry.ts';
import { insertVisual, spanAtPlayhead } from '../../model/new-items.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { applyLibraryEntry, waitForAsset } from '../../runtime/library-commands.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { transactionLabel } from '../../runtime/video-controller.ts';
import { useEditorActions } from './editor-context.tsx';
import { useFinishInsert } from './use-insert-visual.ts';
import { BRAND_COPY as IB } from './brand-copy.ts';

function currentSequence(): Sequence | null {
  const snapshot = useVideo.getState().video?.state?.video;
  return snapshot ? rootSequence(snapshot) : null;
}

/**
 * 品牌条目放进这个视频（架构设计 §5.9）：`library.applyToVideo` 拷进视频（之后库里的修改不影响视频），按种类放：
 * 图片与图片贴纸放到播放头处的时间线上，Lottie 贴纸用内置播放器新建一层——这两种放置跟着拷贝在同一笔事务里提交，
 * 一步撤销；视频要等拷进来知道时长再放；字体只进素材库；字幕样式在同一笔里让这个视频的字幕都用它。
 */
export function useBrandApply(): (entry: LibraryEntry) => Promise<void> {
  const runtime = useRuntime();
  const { apply } = useEditorActions();
  const finish = useFinishInsert();
  return async (entry) => {
    // 跟着拷贝提交的放置按此刻的视频算：先等编辑器队列里的修改都落下。
    await runtime.videos.settled();
    const video = useVideo.getState().video;
    const snapshot = video?.state?.video;
    const sequence = currentSequence();
    if (!video?.videoId || !canEdit(video) || !snapshot || !sequence) return;
    const content = entry.content as BrandContent;
    const targets = content.kind === 'captionStyle' ? captionStyleTargets(sequence) : [];
    const placement = brandPlacement(content);
    const frame = frameAt(useEditor.getState().playhead, sequence.fps);
    const imported = { assetImportRef: APPLIED_ASSET_REF };
    const lottie = placement === 'lottie' ? { span: spanAtPlayhead(sequence, frame, LOTTIE_SECONDS), label: content.name } : null;
    const image = placement === 'asset' && 'file' in content && content.file.mediaType.startsWith('image/');
    const operations = lottie
      ? insertVisual(sequence, lottie.span, [lottieLayer(content.name, imported)], IB.elementsTrack)
      : image
        ? placeImportedImage(sequence, APPLIED_ASSET_REF, content.name, frame)
        : null;
    let result: LibraryApplyResult;
    try {
      result = await applyLibraryEntry(runtime, {
        videoId: video.videoId,
        entry: { library: 'brand', id: entry.id, version: entry.version },
        ...(targets.length ? { sequenceId: sequence.id, captionItemIds: targets } : {}),
        ...(operations
          ? { expectedRevision: snapshot.revision, operations, ...transactionLabel(EditLabel.addNamed({ name: content.name })) }
          : {}),
      });
    } catch (error) {
      ToastQueue.negative(libraryErrorText(IB.actionPlace(content.name), error), { timeout: 6000 });
      return;
    }

    if (content.kind === 'captionStyle') {
      ToastQueue.positive(targets.length ? IB.appliedToCaptions(content.name, targets.length) : IB.copiedNoCaptions(content.name), {
        timeout: 4000,
      });
      return;
    }
    if (lottie) {
      finish(sequence, lottie, result.receipt);
      return;
    }
    if (image) {
      ToastQueue.positive(IB.placedAtPlayhead(content.name), { timeout: 4000 });
      return;
    }
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
    if (!isPlaceable(asset)) {
      ToastQueue.neutral(IB.copiedNotPlaceable(content.name), { timeout: 5000 });
      return;
    }
    const receipt = await apply(
      placeAsset(fresh, asset, frameAt(useEditor.getState().playhead, fresh.fps)),
      EditLabel.addNamed({ name: content.name }),
    );
    if (receipt) ToastQueue.positive(IB.placedAtPlayhead(content.name), { timeout: 4000 });
  };
}
