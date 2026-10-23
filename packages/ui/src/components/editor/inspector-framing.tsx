import { FOCAL_MAX_ZOOM, focalZoom, type Sequence } from '@baocut/protocol';
import { EditLabel } from '@baocut/protocol/messages/ui';
import { Button } from '@react-spectrum/s2';
import FullScreen from '@react-spectrum/s2/icons/FullScreen';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { STAGE_COPY } from '../../copy.ts';
import { rootSequence } from '../../model/editor.ts';
import { framingOperations, isFramed, withZoom, type FramedVideo } from '../../model/stage-framing.ts';
import type { Assets } from '../../model/stage-pose.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { FramingInfo, freeFraming } from './framing-info.tsx';
import { LayoutRow } from './inspector-panels.tsx';
import { Note, Sec, SecHead, ValueRow } from './inspector-controls.tsx';
import type { ItemEdit } from './use-item-edit.ts';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

const modeRow = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, font: 'ui-sm', color: 'gray-800' });
const modeIcon = iconStyle({ size: 'S', color: 'gray' });
const grow = style({ flexGrow: 1, minWidth: 0 });
const freeRow = style({ display: 'flex' });

/**
 * 「取景」段（原型 stage-framing.jsx 的 `FramingSection`，产品设计 §5.10「画面怎么取景」）：按原片取景的视频顶替几何段——
 * 位置、大小、旋转由取景点与画幅现算，没有意义；只留「放大」（100% 就是刚好铺满，围着取景点），同一句为什么，
 * 和明确的出口「改成自由摆放」。拖滑杆时只叠草稿，松手按视频里的实际值比出变了的取景点再提交。视频才有「版式」一行
 * （一人 / 分屏，`inspector-panels.tsx`）。
 */
export function FramingSection({
  item,
  sequence,
  assets,
  edit,
  isDisabled,
}: {
  item: FramedVideo;
  sequence: Sequence;
  assets?: Assets;
  edit: ItemEdit;
  isDisabled: boolean;
}) {
  const actions = useEditorActions();
  const percent = Math.round(focalZoom(item.focalPoint) * 100);
  const free = isDisabled ? null : () => freeFraming(actions, sequence, item, assets);
  const commit = (value: number) => {
    // 属性页拿到的是叠了草稿的片段：要和视频里的实际值比，否则拖过滑杆之后什么都比不出来。
    const snapshot = useVideo.getState().video?.state?.video;
    const stored = (snapshot ? rootSequence(snapshot) : null)?.items.find((other) => other.id === item.id);
    const base = stored && isFramed(stored) ? stored : item;
    const operations = framingOperations(sequence.id, base, withZoom(base, value / 100));
    if (operations.length) edit.commit(operations, EditLabel.zoomFraming());
    else useEditor.getState().clearDrafts();
  };
  return (
    <>
      <SecHead>{IC.framing}</SecHead>
      <Sec>
        <div className={modeRow}>
          <FullScreen styles={modeIcon} />
          <span className={grow}>{STAGE_COPY.framingMode}</span>
          <FramingInfo placement="bottom end" onFree={free} />
        </div>
        <ValueRow
          label={IC.framingZoom}
          value={percent}
          min={100}
          max={FOCAL_MAX_ZOOM * 100}
          unit="%"
          isDisabled={isDisabled}
          onLive={(value) => edit.live({ framing: withZoom(item, value / 100) })}
          onCommit={commit}
        />
        {item.type === 'video' ? <LayoutRow item={item} sequence={sequence} isDisabled={isDisabled} /> : null}
        <Note>{STAGE_COPY.framingLimits}</Note>
        <div className={freeRow}>
          <Button variant="secondary" size="S" isDisabled={!free} onPress={() => free?.()}>
            {STAGE_COPY.framingFree}
          </Button>
        </div>
      </Sec>
    </>
  );
}
