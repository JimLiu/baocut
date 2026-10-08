import type { FrameSpan, Sequence } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { rootSequence } from '../../model/editor.ts';
import { formatClock } from '../../model/format.ts';
import { createdItemIds, insertVisual, type VisualLayer } from '../../model/new-items.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';

export interface InsertRequest {
  span: FrameSpan;
  layers: readonly VisualLayer[];
  /** 撤销记录与提示里的名字（「贴纸 · 心形」）。 */
  label: string;
  /** 新建的轨道叫什么。 */
  trackName?: string;
  /** 建好之后选中第几层（文字预设选第一条文字）。 */
  selectLayer?: number;
}

/**
 * 元素与文字面板的「点一下就新建」（原型 §14）：在播放头处新建、选中、翻到属性页，提示里带起止与「撤销」。
 * 回执先于视频事件到不了：选中用的 ID 从回执里取，再按新视频筛掉轨道与文档。
 */
export function useInsertVisual(): (sequence: Sequence, request: InsertRequest) => Promise<void> {
  const { apply, undo } = useEditorActions();
  return async (sequence, { span, layers, label, trackName, selectLayer = 0 }) => {
    const receipt = await apply(insertVisual(sequence, span, layers, trackName), EL.addNamed(label));
    if (!receipt) return;
    const snapshot = useVideo.getState().video?.state?.video;
    const fresh = (snapshot && rootSequence(snapshot)) ?? sequence;
    const ids = createdItemIds(receipt.createdIds, fresh);
    const pick = ids[selectLayer] ?? ids[0];
    useEditor.getState().select(pick ? [pick] : []);
    // 已经有选中时，侧栏不会因为选区从有到有而自己翻页。
    useEditor.setState({ panelTab: 'props' });
    const perSecond = sequence.fps.num / sequence.fps.den;
    const start = span.fromFrame / perSecond;
    const end = (span.fromFrame + span.durationFrames) / perSecond;
    ToastQueue.positive(EL.added(label, formatClock(start), formatClock(end)), {
      timeout: 5000,
      actionLabel: EL.undo,
      onAction: () => void undo({ transaction: receipt.transactionId }),
      shouldCloseOnAction: true,
    });
  };
}
