import { APPLIED_ASSET_REF, type PetRef } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { ToastQueue } from '@react-spectrum/s2';
import { petLayer } from '../../model/codex-pets.ts';
import { frameAt, rootSequence } from '../../model/editor.ts';
import { LOTTIE_SECONDS } from '../../model/library-brand.ts';
import { insertVisual, spanAtPlayhead } from '../../model/new-items.ts';
import { PET_COPY as PT } from '../../model/pet-copy.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { applyPet } from '../../runtime/pet-commands.ts';
import { transactionLabel } from '../../runtime/video-controller.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { useFinishInsert } from './use-insert-visual.ts';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';

/**
 * 一只 Codex Pet 放进这个视频：`pets.applyToVideo` 把待机那一行编成的 APNG 拷进视频，同一笔事务里在播放头处新建一层贴纸
 * 画它（`assetImportRef` 指向拷进来的那份），一步撤销。第一次用的 pet 要先下载图集，可能要等几秒。
 */
export function useCodexPet(): (pet: PetRef, name: string) => Promise<void> {
  const runtime = useRuntime();
  const finish = useFinishInsert();
  return async (pet, name) => {
    await runtime.videos.settled();
    const video = useVideo.getState().video;
    const snapshot = video?.state?.video;
    const sequence = snapshot ? rootSequence(snapshot) : null;
    if (!video?.videoId || !canEdit(video) || !snapshot || !sequence) return;
    const frame = frameAt(useEditor.getState().playhead, sequence.fps);
    const request = { span: spanAtPlayhead(sequence, frame, LOTTIE_SECONDS), label: name };
    const layers = [petLayer(name, { assetImportRef: APPLIED_ASSET_REF })];
    try {
      const result = await applyPet(runtime, {
        videoId: video.videoId,
        pet,
        name,
        expectedRevision: snapshot.revision,
        operations: insertVisual(sequence, request.span, layers, EL.elementsTrack),
        ...transactionLabel(EditLabel.addNamed({ name })),
      });
      finish(sequence, request, result.receipt);
    } catch (error) {
      ToastQueue.negative(PT.addFailed(error instanceof Error ? error.message : String(error)), { timeout: 6000 });
    }
  };
}
