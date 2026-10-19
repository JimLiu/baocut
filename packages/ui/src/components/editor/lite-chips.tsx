import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { framesToSeconds, secondsToFrames, sequenceDurationFrames, type Sequence } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { chipEdge, dragEdgeFrame, edgeChange, nudgeEdgeFrame, signedTenths, type ChipEdge } from '../../model/chapter-edges.ts';
import { sequenceChapters } from '../../model/chapters.ts';
import { formatClock } from '../../model/format.ts';
import {
  liteBoundaryPreview,
  liteChips,
  liteFitZoom,
  liteKeepInView,
  liteSegmentAt,
  liteZoomIn,
  liteZoomOut,
  type LiteSegment,
  type LiteZoomAction,
} from '../../model/lite-segments.ts';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { moveChapter } from './chapter-commands.ts';
import { useEditorActions } from './editor-context.tsx';
import { LITE_COPY as L } from './lite-copy.ts';

/** 走带的缩放按钮、百分比菜单与快捷键都走这一个口（与时间线的 `TimelineHandle.zoom` 同一种做法）。 */
export interface LiteChipsHandle {
  zoom(action: LiteZoomAction): void;
}

const STRIP_H = 64;
/** 边界把手的宽（像素），贴在片的右边内侧。 */
const EDGE_W = 8;
/** 拖边界时吸附播放头的距离（像素），与章节条同一个值。 */
const SNAP_PX = 6;
/** 按下后移动超过这么多像素才算拖动，否则当成点了一下片。 */
const DRAG_PX = 3;
/** 浮出的时长离条的左右两端至少留这么多（像素）。 */
const BUBBLE_MARGIN = 40;

const wrap = style({ position: 'relative', flexShrink: 0 });
const scroller = style({
  position: 'relative',
  overflow: 'auto',
  backgroundColor: 'gray-25',
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  userSelect: 'none',
});
const strip = style({
  position: 'relative',
  display: 'flex',
  gap: 4,
  boxSizing: 'border-box',
  height: STRIP_H,
  minWidth: 'full',
  paddingX: 12,
  paddingY: 8,
});
const chip = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'end',
  minWidth: 0,
  height: 'full',
  boxSizing: 'border-box',
  borderRadius: 'default',
  overflow: 'hidden',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-300', isCurrent: 'blue-800' },
  backgroundColor: { default: 'gray-100', isHovered: 'gray-200' },
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
});
const chipBody = style({ position: 'absolute', top: 0, bottom: 0, insetStart: 0, insetEnd: 0, outlineStyle: 'none' });
const fill = style({ position: 'absolute', insetStart: 0, top: 0, bottom: 0, backgroundColor: 'blue-200', pointerEvents: 'none' });
const index = style({ position: 'absolute', top: 4, insetStart: 8, font: 'ui-xs', color: 'gray-600', pointerEvents: 'none' });
const label = style({
  position: 'relative',
  font: 'ui-xs',
  color: 'gray-900',
  paddingX: 8,
  paddingBottom: 4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
});
const headLine = style({ position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: 'blue-900', pointerEvents: 'none' });
const hoverLine = style({ position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'gray-600', pointerEvents: 'none' });
const edge = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetEnd: 0,
  zIndex: 1,
  width: EDGE_W,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'ew-resize',
  borderRadius: 'sm',
  outlineStyle: { default: 'none', isFocused: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
});
const edgeTick = style({ width: 2, height: 24, borderRadius: 'full', backgroundColor: { default: 'gray-600', isActive: 'blue-900' } });
const bubble = style({
  position: 'absolute',
  bottom: '[100%]',
  zIndex: 2,
  paddingX: 8,
  paddingY: 4,
  borderRadius: 'default',
  backgroundColor: 'gray-900',
  color: 'gray-25',
  font: 'code-xs',
  whiteSpace: 'nowrap',
  boxShadow: 'elevated',
  pointerEvents: 'none',
});
const bubbleDelta = style({ color: 'gray-300' });

/** 拖着的边界：哪一片的右边、按下时的指针与那一片的右缘（相对外框）、每秒多少像素（按下时量，拖动中片宽在变，不再量）。 */
interface EdgeDrag {
  edge: ChipEdge;
  x0: number;
  left0: number;
  pxPerSec: number;
  frame: number;
  moved: boolean;
  snapped: boolean;
}

/** 时长的写法：一分钟以内写秒（`54s`），再长写钟点（`1:05`）。 */
const durationText = (seconds: number) => (Math.round(seconds) < 60 ? L.seconds(String(Math.round(seconds))) : formatClock(seconds));
const round1 = (seconds: number) => Math.round(seconds * 10) / 10;

/**
 * 片条（轻量编辑器设计 §3「片条」；原型 editor-lite.jsx 的 `LiteSegBar`）：每段一片，宽按时长占比；当前段描蓝边、填到播放头，
 * 之前的段整片淡填。按下即定位、按住拖动连续定位（整条上任意位置，片与片的缝算下一片的起点），悬停出一道细线。
 * ⌘/Ctrl + 滚轮缩放，放大后竖向滚轮横着滚；播放头出了视野滚到让它落在 1/3 处（`liteKeepInView`），拖动中不抢滚动。
 * 片可聚焦，Enter / 空格跳到段首。缩放的几种动作由 `handle.zoom` 接（走带与快捷键）。
 *
 * 章节段（末章除外）的右边有把手（§3.2）：拖的是与下一章的边界，总长不变，两边各至少留 1 秒（`chipEdge`），6px 内吸附播放头，
 * Esc 取消；拖动中片宽按新边界预览，把手上方浮出新时长与增减量。松手提交，与章节条拖起点同一笔 `upsertChapter`（`moveChapter`），
 * 出带「撤销」的提示；没拖开就当点了一下片。把手可聚焦，← / → 各 1 秒、⇧ 各 0.1 秒，每按一下提交一步。
 * 旁白分段与整条一段是派生的，没有把手；视频只读时也没有。
 */
export function LiteChips({
  sequence,
  segments,
  duration,
  handle,
}: {
  sequence: Sequence;
  segments: readonly LiteSegment[];
  duration: number;
  handle: RefObject<LiteChipsHandle | null>;
}) {
  const actions = useEditorActions();
  const { seek } = actions;
  const playhead = useEditor((s) => s.playhead);
  const zoom = useEditor((s) => s.liteZoom);
  const setLiteZoom = useEditor((s) => s.setLiteZoom);
  const editable = useVideo((s) => canEdit(s.video));
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fps = sequence.fps;
  const totalFrames = sequenceDurationFrames(sequence);
  const chapters = useMemo(() => sequenceChapters(sequence), [sequence]);
  const edges = useMemo(
    () => (editable ? segments.map((_, i) => chipEdge(segments, chapters, i, fps, totalFrames)) : []),
    [editable, segments, chapters, fps, totalFrames],
  );
  const [edgeDrag, setEdgeDragState] = useState<EdgeDrag | null>(null);
  // 指针事件可能比重绘来得快：手势以 ref 为准，state 只用来重画（同章节条）。
  const edgeDragRef = useRef<EdgeDrag | null>(null);
  const setEdgeDrag = (next: EdgeDrag | null) => {
    edgeDragRef.current = next;
    setEdgeDragState(next);
  };
  const [focusedEdge, setFocusedEdge] = useState<number | null>(null);
  // 键盘连按时上一步可能还没落回序列：下一步从还没落地的那一帧接着挪；序列一变就以序列为准。
  const pendingNudge = useRef<{ chapterId: string; frame: number } | null>(null);
  useEffect(() => {
    pendingNudge.current = null;
  }, [sequence]);

  const shown = useMemo(
    () => (edgeDrag?.moved ? liteBoundaryPreview(segments, edgeDrag.edge.index, framesToSeconds(edgeDrag.frame, fps)) : segments),
    [edgeDrag, segments, fps],
  );
  const chips = liteChips(shown, playhead, duration, edgeDrag ? null : hover);
  const current = liteSegmentAt(shown, playhead);

  const chipElements = () => (stripRef.current ? (Array.from(stripRef.current.children) as HTMLElement[]) : []);
  /** 指针横坐标对应的时间：片内按比例，片与片之间算下一片的起点，条外按两端。 */
  const timeAt = (clientX: number): number => {
    const elements = chipElements();
    for (let i = 0; i < elements.length; i++) {
      const segment = segments[i];
      if (!segment) break;
      const rect = elements[i]!.getBoundingClientRect();
      if (clientX < rect.left) return i === 0 ? 0 : segment.start;
      if (clientX <= rect.right)
        return segment.start + (rect.width > 0 ? (clientX - rect.left) / rect.width : 0) * (segment.end - segment.start);
    }
    return duration;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    setHover(null);
    seek(timeAt(event.clientX));
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (edgeDragRef.current) return;
    if (dragging.current) seek(timeAt(event.clientX));
    else setHover(timeAt(event.clientX));
  };
  const onPointerEnd = () => {
    dragging.current = false;
  };

  // ---- 拖边界 ----

  /** 提交一步：与章节条拖起点同一笔事务，提示里报这一片的新时长，带「撤销」。 */
  const commitEdge = (edge: ChipEdge, frame: number): Promise<boolean> => {
    const segment = segments[edge.index];
    if (!segment) return Promise.resolve(false);
    const change = edgeChange(segment, frame, fps);
    return moveChapter(actions, sequence, edge.chapter, frame, L.edgeMoved(segment.title, durationText(change.duration)));
  };

  const onEdgeDown = (event: ReactPointerEvent<HTMLDivElement>, edge: ChipEdge) => {
    if (event.button !== 0) return;
    // 不让片条接去当拖播放头。
    event.stopPropagation();
    event.preventDefault();
    const chipRect = chipElements()[edge.index]?.getBoundingClientRect();
    const wrapRect = wrapRef.current?.getBoundingClientRect();
    const segment = segments[edge.index];
    const span = segment ? segment.end - segment.start : 0;
    setHover(null);
    setEdgeDrag({
      edge,
      x0: event.clientX,
      left0: chipRect && wrapRect ? chipRect.right - wrapRect.left : 0,
      pxPerSec: chipRect && span > 0 ? chipRect.width / span : 0,
      frame: edge.chapter.startFrame,
      moved: false,
      snapped: false,
    });
  };

  const onEdgeMove = (event: PointerEvent) => {
    const current = edgeDragRef.current;
    if (!current || current.pxPerSec <= 0) return;
    if (!current.moved && Math.abs(event.clientX - current.x0) < DRAG_PX) return;
    const perSecond = fps.num / fps.den;
    const next = dragEdgeFrame({
      frame: current.edge.chapter.startFrame + secondsToFrames((event.clientX - current.x0) / current.pxPerSec, fps),
      playheadFrame: Math.round(useEditor.getState().playhead * perSecond),
      pxPerFrame: current.pxPerSec / perSecond,
      snapPx: SNAP_PX,
      bounds: current.edge.bounds,
    });
    setEdgeDrag({ ...current, moved: true, frame: next.frame, snapped: next.snapped });
  };

  const onEdgeEnd = () => {
    const done = edgeDragRef.current;
    setEdgeDrag(null);
    if (!done) return;
    // 没拖开就是点了一下片：照常按指针的位置定位。
    if (!done.moved) seek(timeAt(done.x0));
    else void commitEdge(done.edge, done.frame);
  };

  const edgeHandlers = useRef({ move: onEdgeMove, end: onEdgeEnd });
  edgeHandlers.current = { move: onEdgeMove, end: onEdgeEnd };
  const edgeDragging = edgeDrag !== null;
  useEffect(() => {
    if (!edgeDragging) return;
    const onMove = (event: PointerEvent) => {
      if (event.buttons === 0) setEdgeDrag(null);
      else edgeHandlers.current.move(event);
    };
    const onUp = (event: PointerEvent) => {
      edgeHandlers.current.move(event);
      edgeHandlers.current.end();
    };
    const onCancel = () => setEdgeDrag(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setEdgeDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [edgeDragging]);

  /** 把手上的 ← / →：各 1 秒，⇧ 各 0.1 秒，每按一下提交一步；拦住冒泡，别让编辑器的方向键再去挪播放头。 */
  const onEdgeKey = (event: ReactKeyboardEvent<HTMLDivElement>, edge: ChipEdge) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    const step = (event.shiftKey ? 0.1 : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
    const pending = pendingNudge.current;
    const from = pending && pending.chapterId === edge.chapter.id ? pending.frame : edge.chapter.startFrame;
    const frame = nudgeEdgeFrame(edge, from, step, fps);
    if (frame === from) return;
    pendingNudge.current = { chapterId: edge.chapter.id, frame };
    void commitEdge(edge, frame).then((ok) => {
      if (!ok && pendingNudge.current?.frame === frame) pendingNudge.current = null;
    });
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const z = useEditor.getState().liteZoom;
        setLiteZoom(event.deltaY < 0 ? liteZoomIn(z) : liteZoomOut(z));
      } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && element.scrollWidth > element.clientWidth) {
        event.preventDefault();
        element.scrollLeft += event.deltaY;
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [setLiteZoom]);

  // 播放头跟随：当前片内的播放头位置换成条上的横坐标，出了视野就滚。
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || dragging.current || edgeDragRef.current || !current) return;
    const element = chipElements()[current.index];
    if (!element) return;
    const length = current.end - current.start;
    const fraction = length > 0 ? (playhead - current.start) / length : 0;
    const headX = element.offsetLeft + fraction * element.offsetWidth;
    const next = liteKeepInView(headX, scroller.scrollLeft, scroller.clientWidth);
    if (next !== null) scroller.scrollLeft = next;
  }, [playhead, zoom, current]);

  useImperativeHandle(
    handle,
    () => ({
      zoom(action) {
        const z = useEditor.getState().liteZoom;
        const at = liteSegmentAt(segments, useEditor.getState().playhead);
        if (action === 'in' || action === 'playhead') setLiteZoom(liteZoomIn(z));
        else if (action === 'out') setLiteZoom(liteZoomOut(z));
        else if (action === 'fit') setLiteZoom(1);
        else if (action === 'segment') {
          setLiteZoom(liteFitZoom(at, duration));
          // 宽度换完再滚：让这一段的起点贴到视野左边。
          if (at) requestAnimationFrame(() => chipElements()[at.index]?.scrollIntoView({ inline: 'start', block: 'nearest' }));
        }
      },
    }),
    [segments, duration, setLiteZoom],
  );

  const onChipKey = (event: ReactKeyboardEvent<HTMLDivElement>, start: number) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    seek(start);
  };

  // 拖动中浮出的新时长与增减量：贴在被拖的边界上方，按按下时量的每秒像素跟着指针走。
  let tip: { left: number; duration: string; delta: string } | null = null;
  if (edgeDrag?.moved) {
    const segment = segments[edgeDrag.edge.index];
    if (segment) {
      const change = edgeChange(segment, edgeDrag.frame, fps);
      const x = edgeDrag.left0 + change.delta * edgeDrag.pxPerSec;
      const width = wrapRef.current?.clientWidth ?? 0;
      tip = {
        left: width > BUBBLE_MARGIN * 2 ? Math.max(BUBBLE_MARGIN, Math.min(width - BUBBLE_MARGIN, x)) : x,
        duration: durationText(change.duration),
        delta: L.seconds(signedTenths(change.delta)),
      };
    }
  }

  return (
    <div ref={wrapRef} className={wrap}>
      <div ref={scrollRef} className={`${scroller} bc-scroll`} role="group" aria-label={L.chips}>
        <div
          ref={stripRef}
          className={strip}
          style={{ width: `${zoom * 100}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={() => setHover(null)}
        >
          {chips.map((c) => {
            const range = L.range(formatClock(c.start), formatClock(c.end));
            const past = current ? c.index < current.index : false;
            const edgeAt = edges[c.index] ?? null;
            const dragged = !!edgeAt && edgeDrag?.edge.index === c.index;
            const focused = focusedEdge === c.index;
            return (
              <div
                key={c.id}
                className={chip({ isCurrent: c.current, isHovered: c.hover !== null })}
                style={{ flexGrow: c.flex, flexBasis: 0 }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={L.chipLabel(c.title, range)}
                  aria-current={c.current ? 'true' : undefined}
                  title={`${c.title} · ${range}`}
                  className={chipBody}
                  onKeyDown={(event) => onChipKey(event, c.start)}
                />
                {c.head !== null ? (
                  <div className={fill} style={{ width: `${c.head * 100}%` }} />
                ) : past ? (
                  <div className={fill} style={{ width: '100%' }} />
                ) : null}
                <span className={index}>{c.index + 1}</span>
                <span className={label}>{c.title}</span>
                {c.hover !== null ? <div className={hoverLine} style={{ left: `${c.hover * 100}%` }} /> : null}
                {c.head !== null ? <div className={headLine} style={{ left: `calc(${c.head * 100}% - 1px)` }} /> : null}
                {edgeAt ? (
                  <div
                    role="separator"
                    tabIndex={0}
                    aria-orientation="vertical"
                    aria-label={L.edgeLabel(c.title, durationText(c.span))}
                    aria-valuemin={round1(framesToSeconds(edgeAt.bounds.min, fps))}
                    aria-valuemax={round1(framesToSeconds(edgeAt.bounds.max, fps))}
                    aria-valuenow={round1(c.end)}
                    aria-valuetext={durationText(c.span)}
                    title={L.edgeHint}
                    className={edge({ isFocused: focused })}
                    onPointerDown={(event) => onEdgeDown(event, edgeAt)}
                    onKeyDown={(event) => onEdgeKey(event, edgeAt)}
                    onFocus={() => setFocusedEdge(c.index)}
                    onBlur={() => setFocusedEdge((at) => (at === c.index ? null : at))}
                  >
                    {c.hover !== null || dragged || focused ? (
                      <span className={edgeTick({ isActive: dragged && !!edgeDrag?.moved })} />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {tip ? (
        <div className={bubble} style={{ left: tip.left, transform: 'translateX(-50%)' }} aria-hidden>
          {tip.duration} <span className={bubbleDelta}>{tip.delta}</span>
        </div>
      ) : null}
    </div>
  );
}
