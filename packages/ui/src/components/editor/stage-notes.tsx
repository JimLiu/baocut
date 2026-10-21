import { useRef, useState } from 'react';
import type { FileTarget, Id, SpaceEntry } from '@baocut/protocol';
import { ActionButton, Popover, Text, ToastQueue } from '@react-spectrum/s2';
import Delete from '@react-spectrum/s2/icons/Delete';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { markAnchor, markOfAnnotation } from '../../model/markup.ts';
import {
  videoAnnotationFrameLabel,
  videoAnnotationFrameTexts,
  videoAnnotationPins,
  type VideoAnnotationPin,
} from '../../model/video-annotations.ts';
import { VIDEO_NOTES as V } from '../../model/video-annotations-copy.ts';
import { useDraftVideoAnnotationList, useDraftVideoAnnotations } from '../../state/draft-video-annotations-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { videoTargetOf } from '../../model/space.ts';
import { targetKey } from '../../model/workspace.ts';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { drawing, pct, pinMark, stampMark, SvgMark, SVG_KINDS, textLook, textMark } from './markup-marks.tsx';

/*
 * 视频标注（产品设计 §3.2.3「视频标注」、§5.3；移植自原型 stage-notes.jsx）：编辑器预览画面上的标注层——画已进草稿的标注。
 * 画标注的手势归标记层与标记工具条（markup.tsx，lite-editor §4.1；舞台条的「标记」打开，两种视图同一套），按「添加到对话」或发评论时
 * 这一条进这部视频的草稿（draft-video-annotations-store），画面上出对应的标记。标记的画法与标记层同一套（markup-marks.tsx）：画出来
 * 什么样，进了草稿还是什么样，只多一枚写着那一条序号的钮（点开看批注、从对话里移除）。同一帧的几处标记算一条（lite-editor §4.1）：
 * 一个编号，钮只放在这一帧第一处标记上，弹层写这一帧的说法与各处批注，移除时整帧一起移除。标记只画播放头附近那一帧的；别的时刻的在
 * composer 列表里，点一条跳到那个时刻。发送后草稿清空，标记随之消失。标注层盖在画面与舞台点选层之上、标记层之下（preview.tsx），全屏播放器不画。
 */

/** 标注层铺满画面：标记按归一化坐标落位，画幅与尺寸变了标记仍在原处。不裁边，靠边的编号不被切掉。层本身不接指针，只有序号钮接。 */
const layer = style({ position: 'absolute', zIndex: 9, pointerEvents: 'none' });
/** 序号钮的落点：标记锚点上一个 0×0 的壳，钮从这里按自己的画法偏移（编号以点为中心，印章的尖角落在点上）。 */
const anchorWrap = style({ position: 'absolute', width: 0, height: 0, pointerEvents: 'auto', zIndex: 1 });
const pinNote = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8, width: 280, maxWidth: 'full' });
const pinWhere = style({ font: 'ui-xs', color: 'gray-600', margin: 0, overflowWrap: 'anywhere' });
const pinText = style({ font: 'ui-sm', margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });

/** 画面上的标注层：有草稿时画这一帧的标记。`frame` 是画面在舞台里的位置（像素）。 */
export function StageNotesLayer({ videoId, frame }: { videoId: Id; frame: { left: number; top: number; width: number; height: number } }) {
  const notes = useDraftVideoAnnotationList(videoId);
  const playhead = useEditor((s) => s.playhead);
  if (!notes.length) return null;
  const remove = (ids: readonly string[]) => useDraftVideoAnnotations.getState().remove(videoId, ids);
  const pins = videoAnnotationPins(notes, videoId, playhead);
  const size = { w: frame.width, h: frame.height };
  return (
    <div className={layer} style={frame} data-video-annotations onClick={(event) => event.stopPropagation()}>
      <svg className={drawing} width={size.w} height={size.h} aria-hidden>
        {pins.map((pin) => (SVG_KINDS.has(pin.kind) ? <SvgMark key={pin.id} mark={markOfAnnotation(pin)} frame={size} /> : null))}
      </svg>
      {pins.map((pin) => (
        <StageNoteMark key={pin.id} pin={pin} onRemove={remove} />
      ))}
    </div>
  );
}

/**
 * 一处标记的 HTML 部分：文字标记的字（线、框、圆、画笔与元素框在上面的 SVG 里），这一帧的第一处另加一枚写着那一条序号的钮，落在标记的
 * 锚点上；编号标记与评论自己就是那枚圆点 / 印章，同一帧的别处也照样带（画面上写序号，对着 composer 的列表；截图上的印章写缩写）。
 * 点钮看这一帧的说法与批注，可以整帧从对话里移除。
 */
function StageNoteMark({ pin, onRemove }: { pin: VideoAnnotationPin; onRemove: (ids: readonly string[]) => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const mark = markOfAnnotation(pin);
  const tone = mark.color;
  const anchor = markAnchor(mark);
  const label = videoAnnotationFrameLabel(pin.frame.items);
  const texts = videoAnnotationFrameTexts(pin.frame.items);
  // 标记工具画的标记可以没有批注：读屏名退回这一帧的说法
  const said = texts.join('; ') || label;
  const badge = pin.lead || pin.kind === 'comment' || pin.kind === 'pin';
  const look = textLook(mark);
  return (
    <>
      {pin.kind === 'text' ? (
        <span
          className={textMark({ tone, family: look.family })}
          style={{ left: pct(mark.x), top: pct(mark.y), ...look.style }}
          data-mark="text"
          aria-hidden
        >
          {mark.text}
        </span>
      ) : null}
      {badge ? (
        <span className={anchorWrap} style={{ left: pct(anchor.x), top: pct(anchor.y) }} onPointerDown={(event) => event.stopPropagation()}>
          <RACButton
            ref={buttonRef}
            className={(rp) => {
              const on = { tone, isButton: true, isHovered: rp.isHovered, isPressed: rp.isPressed, isFocusVisible: rp.isFocusVisible };
              return pin.kind === 'comment' ? stampMark(on) : pinMark(on);
            }}
            aria-label={V.mark(pin.n, said)}
            aria-expanded={open}
            aria-haspopup="dialog"
            data-mark={pin.kind}
            onPress={() => setOpen((v) => !v)}
          >
            {pin.n}
          </RACButton>
          <Popover
            triggerRef={buttonRef}
            isOpen={open}
            onOpenChange={setOpen}
            placement="bottom"
            padding="default"
            aria-label={V.mark(pin.n, said)}
          >
            <div className={pinNote}>
              <p className={pinWhere}>{label}</p>
              {texts.map((text, i) => (
                <p key={i} className={pinText}>
                  {text}
                </p>
              ))}
              <ActionButton
                isQuiet
                size="S"
                onPress={() => {
                  setOpen(false);
                  onRemove(pin.frame.items.map((n) => n.id));
                }}
              >
                <Delete />
                <Text>{V.removeFromChat}</Text>
              </ActionButton>
            </div>
          </Popover>
        </span>
      ) : null}
    </>
  );
}

/**
 * 这条标注标的是哪部视频（视频 id）：草稿里自带；已发送的按 `video` 定位找——此刻开着的那部，或 Space 里同一位置的视频条目
 * （回收站里的不算）。找不到时 null。
 */
export function videoIdOfAnnotation(target: FileTarget, entries: readonly SpaceEntry[] = useSpace.getState().entries): Id | null {
  const key = targetKey(target);
  const open = useVideo.getState().video;
  if (open?.videoId && targetKey(open.target) === key) return open.videoId;
  for (const e of entries) {
    if (e.kind !== 'video' || e.user.trashedAt || !e.ref || !('videoId' in e.ref)) continue;
    if (('entryId' in target && target.entryId === e.id) || targetKey(videoTargetOf(e)) === key) return e.ref.videoId;
  }
  return null;
}

/**
 * 点 composer 或已发送消息里的一条视频标注：打开（或切到）那部视频，播放头放到标注的那一刻。开着的就是它时只让引擎跳过去；
 * 视频已经移走或删除时说一句，不跳（原型 stage-notes.jsx `VideoNotesToken` 的 `jump`）。
 */
export function revealVideoAnnotation(target: FileTarget, timeMs: number, knownVideoId?: Id): boolean {
  const videoId = knownVideoId ?? videoIdOfAnnotation(target);
  const seconds = Math.max(0, timeMs) / 1000;
  const open = useVideo.getState().video;
  const editor = useEditor.getState();
  if (videoId && open?.videoId === videoId) {
    useShell.getState().openVideo(open.target);
    editor.requestSeek(seconds);
    return true;
  }
  const entry = videoId
    ? useSpace
        .getState()
        .entries.find((e) => e.kind === 'video' && !e.user.trashedAt && !!e.ref && 'videoId' in e.ref && e.ref.videoId === videoId)
    : undefined;
  if (!videoId || !entry) {
    ToastQueue.negative(V.gone, { timeout: 5000 });
    return false;
  }
  editor.attach(videoId);
  editor.setPlayhead(seconds);
  useShell.getState().openVideo(videoTargetOf(entry));
  return true;
}
