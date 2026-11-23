import { useRef, useState } from 'react';
import { groupVideoAnnotationsByFrame, type FileTarget, type Id, type VideoAnnotation } from '@baocut/protocol';
import { ActionButton, Popover, Text } from '@react-spectrum/s2';
import Close from '@react-spectrum/s2/icons/Close';
import Comment from '@react-spectrum/s2/icons/Comment';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { VIDEO_NOTES } from '../model/video-annotations-copy.ts';
import { videoAnnotationFrameLabel, videoAnnotationFrameTexts, type DraftVideoAnnotation } from '../model/video-annotations.ts';
import { targetKey } from '../model/workspace.ts';
import { draftShotUrl, useDraftVideoAnnotations, type DraftVideoShot } from '../state/draft-video-annotations-store.ts';
import { revealVideoAnnotation } from './editor/stage-notes.tsx';

/** composer 上方与 Space 条目的引用标签同一个样子（composer.tsx `tag`）；已发送消息里只是一行淡色的标记。 */
const token = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  maxWidth: 'full',
  height: 24,
  borderRadius: 'default',
  backgroundColor: { default: 'transparent', isDraft: 'gray-100' },
  font: 'ui-xs',
  color: { default: 'gray-600', isDraft: 'gray-800' },
  boxSizing: 'border-box',
});
/** 原型 home-slides.css `.home-slides-notes__list` 起的那几样。 */
const list = style({ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, margin: 0, padding: 0, overflow: 'auto', listStyleType: 'none' });
const item = style({ display: 'flex', alignItems: 'start', gap: 4 });
const jump = style({
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  flexGrow: 1,
  minWidth: 0,
  padding: 8,
  borderRadius: 'lg',
  borderWidth: 0,
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isPressed: 'gray-200' },
  color: 'gray-900',
  textAlign: 'start',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const badge = style({
  flexShrink: 0,
  size: 20,
  borderRadius: 'full',
  backgroundColor: 'blue-900',
  color: 'gray-25',
  font: 'ui-xs',
  fontWeight: 'bold',
  lineHeight: '[20px]',
  textAlign: 'center',
});
const body = style({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 });
const where = style({ font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const note = style({ font: 'ui-sm', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
/** 视频标注那一帧的截图（原型 stage-notes.css `.stnotes__shot`）：96 宽的小图，底灰，画面按比例放在里面。 */
const shot = style({ display: 'block', width: 96, height: 54, borderRadius: 'sm', backgroundColor: 'gray-300', objectFit: 'contain' });
const panel = style({ width: 360, maxWidth: '[calc(100vw - 32px)]' });
const closeIcon = iconStyle({ size: 'XS' });

/**
 * 列表里的一条视频标注（一帧一行）：`target` 是视频，`timeMs` 是标注的那一刻；草稿里另带视频 id 与那一帧截图的地址 `image`
 * （lite-editor §4.1：截图归标注所有，随它一起移除、一起发出）。
 */
export interface AnnotationTokenItem {
  id: string;
  target: FileTarget;
  label: string;
  text: string;
  timeMs: number;
  videoId?: Id;
  image?: string;
}

/**
 * 视频标注在列表里一帧一行（lite-editor §4.1）：同一帧的几处标记——不论分几次加进来——是一条，写那一帧的说法（「00:42.3 · 3 处标记 ·
 * 画笔、框 ×2」）与各处的批注，点一下跳到那一帧。`id` 是这一帧的键（视频 + 帧）。草稿另由 `draftVideoTokenItems` 带视频 id 与截图。
 */
export function videoTokenItems<T extends VideoAnnotation>(
  notes: readonly T[],
  videoOf: (note: T) => string = (note) => targetKey(note.video),
  extra: (items: readonly T[]) => Partial<AnnotationTokenItem> = () => ({}),
): AnnotationTokenItem[] {
  return groupVideoAnnotationsByFrame(notes, videoOf).map((frame) => ({
    id: frame.key,
    target: frame.items[0]!.video,
    timeMs: frame.timeMs,
    label: videoAnnotationFrameLabel(frame.items),
    text: videoAnnotationFrameTexts(frame.items).join('\n'),
    ...extra(frame.items),
  }));
}

/**
 * composer 上这部视频的草稿：一帧一行，带视频 id 与那一帧画好的截图；移除一行是整帧一起移除（`onRemove` 收到的是这一帧的键）。
 */
export function draftVideoTokenItems(
  videoId: Id,
  notes: readonly DraftVideoAnnotation[],
  shots: Record<number, DraftVideoShot>,
): { items: AnnotationTokenItem[]; onRemove: (id: string) => void; onClear: () => void } {
  return {
    items: videoTokenItems(
      notes,
      (n) => n.videoId,
      (items) => ({ videoId: items[0]!.videoId, image: items.map((n) => draftShotUrl(n, shots)).find(Boolean) }),
    ),
    onRemove: (key) => useDraftVideoAnnotations.getState().removeFrame(videoId, key),
    onClear: () => useDraftVideoAnnotations.getState().clear(videoId),
  };
}

/**
 * 视频标注的引用标签（产品设计 §3.2.3「视频标注」，移植自原型 stage-notes.jsx `VideoNotesToken`）：composer 上方与已发送的消息里
 * 都是「视频标注 · N 条」。点开列出各帧：位置、批注，点一条打开那部视频、播放头放到标注的那一刻。
 * 给了 `onRemove` 是草稿，可以逐条移除或全部移除；不给是已发送的消息，只读。
 */
export function AnnotationsToken({
  items,
  onRemove,
  onClear,
}: {
  items: readonly AnnotationTokenItem[];
  onRemove?: (id: string) => void;
  onClear?: () => void;
}) {
  const copy = VIDEO_NOTES;
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  if (!items.length) return null;
  const draft = !!onRemove;
  const label = copy.token(items.length);
  const reveal = (n: AnnotationTokenItem) => {
    setOpen(false);
    revealVideoAnnotation(n.target, n.timeMs, n.videoId);
  };
  return (
    <span ref={anchorRef} className={token({ isDraft: draft })}>
      <ActionButton isQuiet size="XS" aria-expanded={open} aria-haspopup="dialog" onPress={() => setOpen((v) => !v)}>
        <Comment />
        <Text>{label}</Text>
      </ActionButton>
      {onClear ? (
        <ActionButton isQuiet size="XS" aria-label={copy.removeAll} onPress={onClear}>
          <Close styles={closeIcon} data-bc-icons="own" />
        </ActionButton>
      ) : null}
      <Popover triggerRef={anchorRef} isOpen={open} onOpenChange={setOpen} placement={draft ? 'top start' : 'bottom end'} aria-label={label}>
        <div className={panel}>
          <ol className={list}>
            {items.map((n, i) => (
              <li key={n.id} className={item}>
                <RACButton className={jump} aria-label={copy.item(i + 1, n.label, n.text)} onPress={() => reveal(n)}>
                  <span className={badge}>{i + 1}</span>
                  <span className={body}>
                    <span className={where}>{n.label}</span>
                    {n.image ? <img className={shot} src={n.image} alt="" /> : null}
                    <span className={note}>{n.text}</span>
                  </span>
                </RACButton>
                {onRemove ? (
                  <ActionButton
                    isQuiet
                    size="XS"
                    aria-label={copy.removeOne(i + 1)}
                    onPress={() => {
                      if (items.length === 1) setOpen(false);
                      onRemove(n.id);
                    }}>
                    <Close styles={closeIcon} data-bc-icons="own" />
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </Popover>
    </span>
  );
}
