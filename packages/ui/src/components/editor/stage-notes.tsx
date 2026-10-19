import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  VIDEO_ANNOTATION_LIMITS,
  type FileTarget,
  type Id,
  type SpaceEntry,
  type VideoAnnotationColor,
  type VideoAnnotationKind,
} from '@baocut/protocol';
import { ActionButton, Button, Popover, Text, ToastQueue, ToggleButton, ToggleButtonGroup } from '@react-spectrum/s2';
import Delete from '@react-spectrum/s2/icons/Delete';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import {
  TIMELINE_VIDEO_ANNOTATION_KINDS,
  annotationTimecode,
  normalizeShape,
  videoAnnotationErrorText,
  videoAnnotationLabel,
  videoAnnotationPins,
  videoAnnotationsElsewhere,
  type NormalizedShape,
  type Point,
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
import { NoteForm } from '../workspace/editor-pane.tsx';

/*
 * 视频标注（产品设计 §3.2.3「视频标注」、§5.3；移植自原型 stage-notes.jsx、stage-notes.css）：编辑器预览画面上的标注层与标注模式的小工具条。
 * 舞台工具条的「标注」打开标注模式（stage-bar.tsx `AnnotateToggle`）：画面上方出一条小工具条选种类（框 / 箭头 / 文字 / 编号），
 * 在画面上拖一个框、拖一条箭头，或点一个位置，批注框里写一句「添加到对话」，这一条进这部视频的草稿（draft-video-annotations-store），
 * 画面上出对应的标记。标记只画播放头附近那一帧的；别的时刻的在 composer 列表里，点一条跳到那个时刻。发送后草稿清空，标记随之消失。
 * 标注层盖在画面与舞台点选层之上（preview.tsx），全屏播放器不画。
 */

/** 拖动短于这么多像素算「点了一下」：框与箭头要拖开才收。 */
const MOVE_MIN = 4;

const pct = (v: number) => `${v * 100}%`;

/** 标注层铺满画面：标记按归一化坐标落位，画幅与尺寸变了标记仍在原处。不裁边，靠边的编号不被切掉。 */
const layer = style({
  position: 'absolute',
  zIndex: 9,
  pointerEvents: { default: 'none', isAnnotating: 'auto' },
  cursor: { default: 'default', isAnnotating: 'crosshair', isPoint: 'cell' },
});
/*
 * 标记的颜色：轻量视图的标记工具送来的标注带 `style.color`（红 / 蓝 / 绿 / 黑 / 白，lite-editor §4.1），按 `tone` 取对应的颜色；
 * 没有 `style` 的（时间线视图的标注条画的）按蓝色画，与之前一样。粗细（`style.width`，像素）作为描边宽度内联给出，没有时 2px。
 */
const toneOf = (pin: { style?: { color: VideoAnnotationColor } }): VideoAnnotationColor => pin.style?.color ?? 'blue';
const strokeOf = (pin: { style?: { width: number } }): number => pin.style?.width ?? 2;
const boxMark = style({
  position: 'absolute',
  boxSizing: 'border-box',
  borderWidth: 2,
  borderStyle: { default: 'solid', isGhost: 'dashed' },
  borderColor: { default: 'blue-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  borderRadius: { default: 'sm', isRound: '[50%]' },
  boxShadow: { default: '[0 0 0 1px white]', isGhost: 'none' },
  pointerEvents: 'none',
});
const point = style({ position: 'absolute', width: 0, height: 0 });
const arrow = style({
  position: 'absolute',
  inset: 0,
  width: 'full',
  height: 'full',
  overflow: 'visible',
  pointerEvents: 'none',
  color: { default: 'blue-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
});
const head = style({
  position: 'absolute',
  size: 12,
  borderRadius: 'full',
  backgroundColor: { default: 'blue-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  boxShadow: '[0 0 0 2px white]',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
});
/** 评论的印章：一枚带尖角的圆（像一个对话气泡），颜色跟标记的颜色走，写着在草稿里的序号。 */
const stamp = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 28,
  height: 28,
  paddingX: 4,
  boxSizing: 'border-box',
  borderRadius: 'full',
  borderBottomStartRadius: 'none',
  borderWidth: 0,
  backgroundColor: { default: 'blue-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  color: { default: 'white', tone: { red: 'white', blue: 'white', green: 'white', black: 'white', white: 'black' } },
  boxShadow: '[0 0 0 2px white, 0 1px 4px rgb(0 0 0 / 0.4)]',
  font: 'ui-xs',
  fontWeight: 'bold',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
/** 印章的尖角落在标注的点上：整枚往右上挪开，不像编号那样以点为中心。 */
const stampWrap = style({
  position: 'absolute',
  bottom: 0,
  insetStart: 0,
  pointerEvents: 'auto',
  zIndex: 1,
});
const badgeWrap = style({
  position: 'absolute',
  top: 0,
  insetStart: 0,
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'auto',
  zIndex: 1,
});
const badge = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 24,
  height: 24,
  paddingX: 4,
  boxSizing: 'border-box',
  borderRadius: 'full',
  borderWidth: 0,
  backgroundColor: { default: 'blue-900', isHovered: 'blue-1000', isPressed: 'blue-1000' },
  color: 'white',
  font: 'ui-xs',
  fontWeight: 'bold',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const textLabel = style({
  position: 'absolute',
  insetStart: '[14px]',
  top: '[-10px]',
  maxWidth: 240,
  paddingX: 8,
  paddingY: 2,
  borderRadius: 'lg',
  backgroundColor: { default: 'blue-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  color: { default: 'white', tone: { red: 'white', blue: 'white', green: 'white', black: 'white', white: 'black' } },
  font: 'ui-xs',
  lineHeight: '[20px]',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  pointerEvents: 'none',
});
const anchorDot = style({ position: 'absolute', width: 1, height: 1 });
const pinNote = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8, width: 280, maxWidth: 'full' });
const pinWhere = style({ font: 'ui-xs', color: 'gray-600', margin: 0, overflowWrap: 'anywhere' });
const pinText = style({ font: 'ui-sm', margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
/** 舞台顶上的小工具条：种类、提示、完成。 */
const bar = style({
  position: 'absolute',
  top: 12,
  left: '[50%]',
  transform: 'translateX(-50%)',
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  maxWidth: '[calc(100% - 24px)]',
  boxSizing: 'border-box',
  paddingY: 4,
  paddingStart: 8,
  paddingEnd: 4,
  borderRadius: 'lg',
  backgroundColor: 'layer-2',
  boxShadow: 'elevated',
});
const kinds = style({ flexShrink: 0 });
const hint = style({ font: 'ui-xs', color: 'gray-700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 });

/** 进行中的手势（像素，相对画面）。 */
interface Drag {
  kind: VideoAnnotationKind;
  from: Point;
  to: Point;
}
/** 画完、还没写批注的那一条。 */
interface Pending extends NormalizedShape {
  kind: VideoAnnotationKind;
  timeMs: number;
  label: string;
}

/**
 * 画面上的标注层：有草稿时一直画这一帧的标记，标注模式下再接手势。`frame` 是画面在舞台里的位置（像素）。
 * `gestures` 为 false 时（轻量视图：标注模式的手势归标记层 lite-markup.tsx）只画草稿里的标记，不接手势。
 */
export function StageNotesLayer({
  videoId,
  frame,
  gestures = true,
}: {
  videoId: Id;
  frame: { left: number; top: number; width: number; height: number };
  gestures?: boolean;
}) {
  const notes = useDraftVideoAnnotationList(videoId);
  const annotating = useEditor((s) => s.annotating) && gestures;
  const kind = useEditor((s) => s.noteKind);
  const playhead = useEditor((s) => s.playhead);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!annotating) {
      setDrag(null);
      setPending(null);
    }
  }, [annotating]);

  if (!notes.length && !annotating) return null;

  const at = (event: { clientX: number; clientY: number }): Point => {
    const box = layerRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const from = at(event);
    const size = { w: frame.width, h: frame.height };
    const gesture = kind;
    setDrag({ kind: gesture, from, to: from });
    setPending(null);
    const move = (ev: PointerEvent) => {
      const to = at(ev);
      setDrag((d) => (d ? { ...d, to } : d));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      if (ev.type === 'pointercancel') return;
      const to = at(ev);
      const moved = Math.hypot(to.x - from.x, to.y - from.y) >= MOVE_MIN;
      if ((gesture === 'box' || gesture === 'arrow') && !moved) {
        ToastQueue.neutral(V.hints[gesture], { timeout: 3000 });
        return;
      }
      const shape = normalizeShape(gesture, from, moved ? to : null, size);
      const timeMs = Math.round(useEditor.getState().playhead * 1000);
      setPending({ kind: gesture, ...shape, timeMs, label: videoAnnotationLabel({ kind: gesture, region: shape.region, timeMs }) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const add = (text: string) => {
    if (!pending) return;
    const open = useVideo.getState().video;
    const revision = open?.state?.video.revision;
    if (!open || open.videoId !== videoId || revision === undefined) return;
    const store = useDraftVideoAnnotations.getState();
    const error = store.add(videoId, {
      id: crypto.randomUUID(),
      videoId,
      video: open.target,
      revision,
      timeMs: pending.timeMs,
      kind: pending.kind,
      region: pending.region,
      ...(pending.to ? { to: pending.to } : {}),
      label: pending.label,
      text,
    });
    if (error) {
      ToastQueue.negative(videoAnnotationErrorText(error), { timeout: 5000 });
      return;
    }
    setPending(null);
    const count = useDraftVideoAnnotations.getState().annotations[videoId]?.length ?? 0;
    ToastQueue.neutral(V.added(V.token(count)), { timeout: 3000 });
  };
  const remove = (id: string) => useDraftVideoAnnotations.getState().remove(videoId, id);
  const pins = videoAnnotationPins(notes, videoId, playhead);

  const ghost = drag ? (
    drag.kind === 'box' ? (
      <div
        className={boxMark({ isGhost: true })}
        style={{
          left: Math.min(drag.from.x, drag.to.x),
          top: Math.min(drag.from.y, drag.to.y),
          width: Math.abs(drag.to.x - drag.from.x),
          height: Math.abs(drag.to.y - drag.from.y),
        }}
      />
    ) : drag.kind === 'arrow' ? (
      <svg className={arrow({})} aria-hidden>
        <line
          x1={drag.from.x}
          y1={drag.from.y}
          x2={drag.to.x}
          y2={drag.to.y}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="6 4"
        />
      </svg>
    ) : null
  ) : null;
  const pendingAt = pending ? (pending.to ?? pending.region) : null;

  return (
    <div
      ref={layerRef}
      className={layer({ isAnnotating: annotating, isPoint: annotating && (kind === 'text' || kind === 'pin') })}
      style={frame}
      data-video-annotations
      onPointerDown={annotating ? down : undefined}
      onClick={(event) => event.stopPropagation()}
    >
      {pins.map((pin) => (
        <StageNoteMark key={pin.id} pin={pin} onRemove={remove} />
      ))}
      {ghost}
      {pending?.kind === 'box' ? (
        <div
          className={boxMark({ isGhost: true })}
          style={{ left: pct(pending.region.x), top: pct(pending.region.y), width: pct(pending.region.w), height: pct(pending.region.h) }}
        />
      ) : null}
      {pending?.kind === 'arrow' && pending.to ? (
        <svg className={arrow({})} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line
            x1={pending.region.x * 100}
            y1={pending.region.y * 100}
            x2={pending.to.x * 100}
            y2={pending.to.y * 100}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
      <span
        ref={anchorRef}
        className={anchorDot}
        style={
          pending?.kind === 'box'
            ? { left: pct(pending.region.x + pending.region.w / 2), top: pct(pending.region.y + pending.region.h) }
            : { left: pct(pendingAt?.x ?? 0), top: pct(pendingAt?.y ?? 0) }
        }
      />
      <Popover
        triggerRef={anchorRef}
        isOpen={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        placement="bottom"
        padding="default"
        aria-label={V.addTitle}
      >
        {pending ? (
          <NoteForm
            key={`${pending.kind}@${pending.region.x},${pending.region.y}@${pending.timeMs}`}
            copy={V}
            limit={VIDEO_ANNOTATION_LIMITS.text}
            label={pending.label}
            onAdd={add}
            onCancel={() => setPending(null)}
          />
        ) : null}
      </Popover>
    </div>
  );
}

/**
 * 画面上的一个标记：框是描边的矩形，箭头是一条带头的线，文字是一枚写着批注的签，编号是一枚圆点；都带整份草稿里的序号。
 * 轻量视图的标记工具送来的另五种（lite-editor §4.1）：直线是不带头的线，圆是框里内切的椭圆，画笔是穿过各点的折线，元素是元素的框，
 * 评论是一枚对话气泡样的印章（尖角落在那个点上）。带 `style` 的照它的颜色与粗细画。点序号看批注，可以从对话里移除。
 */
function StageNoteMark({ pin, onRemove }: { pin: VideoAnnotationPin; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const r = pin.region;
  const tone = toneOf(pin);
  const stroke = strokeOf(pin);
  // 标记工具画的标记可以没有批注：读屏名与弹层里退回给人看的位置
  const said = pin.text || pin.label;
  const badgeEl = (
    <span ref={anchorRef} className={pin.kind === 'comment' ? stampWrap : badgeWrap} onPointerDown={(event) => event.stopPropagation()}>
      <RACButton
        className={pin.kind === 'comment' ? stamp({ tone }) : badge}
        aria-label={V.mark(pin.n, said)}
        aria-expanded={open}
        aria-haspopup="dialog"
        onPress={() => setOpen((v) => !v)}
      >
        {pin.n}
      </RACButton>
      <Popover
        triggerRef={anchorRef}
        isOpen={open}
        onOpenChange={setOpen}
        placement="bottom"
        padding="default"
        aria-label={V.mark(pin.n, said)}
      >
        <div className={pinNote}>
          <p className={pinWhere}>{pin.label}</p>
          {pin.text ? <p className={pinText}>{pin.text}</p> : null}
          <ActionButton
            isQuiet
            size="S"
            onPress={() => {
              setOpen(false);
              onRemove(pin.id);
            }}
          >
            <Delete />
            <Text>{V.removeFromChat}</Text>
          </ActionButton>
        </div>
      </Popover>
    </span>
  );
  // 框、圆与元素是描边的矩形（圆画成内切的椭圆）；元素的框可能没有面积（点中的是一条线），这时照样落一个点
  if (pin.kind === 'box' || pin.kind === 'ellipse' || pin.kind === 'element') {
    return (
      <div
        className={boxMark({ isGhost: false, isRound: pin.kind === 'ellipse', tone })}
        style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h), ...(pin.style ? { borderWidth: stroke } : {}) }}
      >
        {badgeEl}
      </div>
    );
  }
  if ((pin.kind === 'arrow' || pin.kind === 'line') && pin.to) {
    return (
      <>
        <svg className={arrow({ tone })} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line
            x1={r.x * 100}
            y1={r.y * 100}
            x2={pin.to.x * 100}
            y2={pin.to.y * 100}
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {pin.kind === 'arrow' ? <span className={head({ tone })} style={{ left: pct(pin.to.x), top: pct(pin.to.y) }} aria-hidden /> : null}
        <div className={point} style={{ left: pct(r.x), top: pct(r.y) }}>
          {badgeEl}
        </div>
      </>
    );
  }
  if (pin.kind === 'pen' && pin.points?.length) {
    const first = pin.points[0]!;
    return (
      <>
        <svg className={arrow({ tone })} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polyline
            points={pin.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className={point} style={{ left: pct(first.x), top: pct(first.y) }}>
          {badgeEl}
        </div>
      </>
    );
  }
  return (
    <div className={point} style={{ left: pct(r.x), top: pct(r.y) }}>
      {badgeEl}
      {pin.kind === 'text' ? <span className={textLabel({ tone })}>{pin.text}</span> : null}
    </div>
  );
}

/** 标注模式的小工具条（舞台顶上）：种类、提示与这一帧的时码、这一帧之外还有几条、完成。 */
export function StageNotesToolbar({ videoId }: { videoId: Id }) {
  const annotating = useEditor((s) => s.annotating);
  const kind = useEditor((s) => s.noteKind);
  const setKind = useEditor((s) => s.setNoteKind);
  const setAnnotating = useEditor((s) => s.setAnnotating);
  const playhead = useEditor((s) => s.playhead);
  const notes = useDraftVideoAnnotationList(videoId);
  if (!annotating) return null;
  const away = videoAnnotationsElsewhere(notes, videoId, playhead);
  return (
    <div className={bar} role="toolbar" aria-label={V.toolbar}>
      <ToggleButtonGroup
        styles={kinds}
        size="S"
        isQuiet
        selectionMode="single"
        disallowEmptySelection
        aria-label={V.kindGroup}
        selectedKeys={[kind]}
        onSelectionChange={(keys) => {
          const next = [...keys][0];
          if (typeof next === 'string' && (TIMELINE_VIDEO_ANNOTATION_KINDS as readonly string[]).includes(next))
            setKind(next as VideoAnnotationKind);
        }}
      >
        {TIMELINE_VIDEO_ANNOTATION_KINDS.map((k) => (
          <ToggleButton key={k} id={k}>
            <Text>{V.kinds[k]}</Text>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <span className={hint} role="status">
        {V.status(V.hints[kind], annotationTimecode(Math.round(playhead * 1000)), away)}
      </span>
      <Button size="S" variant="secondary" onPress={() => setAnnotating(false)}>
        {V.done}
      </Button>
    </div>
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
