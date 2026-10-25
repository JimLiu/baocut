import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatClock } from '../../model/format.ts';
import {
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
import { useEditorActions } from './editor-context.tsx';
import { LITE_COPY as L } from './lite-copy.ts';

/** 走带的缩放按钮、百分比菜单与快捷键都走这一个口（与时间线的 `TimelineHandle.zoom` 同一种做法）。 */
export interface LiteChipsHandle {
  zoom(action: LiteZoomAction): void;
}

const STRIP_H = 64;

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

/**
 * 片条（轻量编辑器设计 §3「片条」；原型 editor-lite.jsx 的 `LiteSegBar`）：每段一片，宽按时长占比；当前段描蓝边、填到播放头，
 * 之前的段整片淡填。按下即定位、按住拖动连续定位（整条上任意位置，片与片的缝算下一片的起点），悬停出一道细线。
 * ⌘/Ctrl + 滚轮缩放，放大后竖向滚轮横着滚；播放头出了视野滚到让它落在 1/3 处（`liteKeepInView`），拖动中不抢滚动。
 * 片可聚焦，Enter / 空格跳到段首。缩放的几种动作由 `handle.zoom` 接（走带与快捷键）。
 * 片只看不改：边不能拖，章节边界到时间线的章节条上改（§3.2）。
 */
export function LiteChips({
  segments,
  duration,
  handle,
}: {
  segments: readonly LiteSegment[];
  duration: number;
  handle: RefObject<LiteChipsHandle | null>;
}) {
  const { seek } = useEditorActions();
  const playhead = useEditor((s) => s.playhead);
  const zoom = useEditor((s) => s.liteZoom);
  const setLiteZoom = useEditor((s) => s.setLiteZoom);
  const [hover, setHover] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const chips = liteChips(segments, playhead, duration, hover);
  const current = liteSegmentAt(segments, playhead);

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
    if (dragging.current) seek(timeAt(event.clientX));
    else setHover(timeAt(event.clientX));
  };
  const onPointerEnd = () => {
    dragging.current = false;
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
    if (!scroller || dragging.current || !current) return;
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

  return (
    <div className={wrap}>
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
