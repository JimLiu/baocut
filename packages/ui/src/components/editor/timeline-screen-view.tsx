import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { POINTER_TRACK_MEDIA_TYPE, type DocumentRecord, type Id, type PointerTrack, type Sequence, type VersionRef } from '@baocut/protocol';
import CursorClick from '@react-spectrum/s2/icons/CursorClick';
import ZoomIn from '@react-spectrum/s2/icons/ZoomIn';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  addZoomChange,
  contentClock,
  contentOffset,
  placeZooms,
  removeZoomChange,
  screenItems,
  ticksToSeconds,
  zoomChanges,
  zoomSeconds,
  type ContentClock,
  type PlacedZoom,
} from '../../model/screen-view.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useScreenViewSelection } from '../../state/screen-view-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { useScreenView } from './use-screen-view.ts';
import { useAssetUrl } from './use-asset-url.ts';
import { SCREEN_VIEW_COPY as SV } from './screen-view-copy.ts';

/*
 * 时间线上屏幕实例的两条附属行（屏幕录制设计 §5「时间线上的样子」）：「缩放」显示取景文档的 `zooms`，空白处拖出一段加、
 * 拖动一段或它的两端改、选中后按删除去掉；「鼠标」显示指针轨的点击，点一下选中屏幕实例去检查器改光标。
 * 不是新的轨道种类：画在屏幕实例所在的轨道行下面，跟着序列时间走（拆开、变速后各段只画自己源区间里的部分）。
 */

/** 附属行的行高。 */
export const SCREEN_VIEW_ROW_HEIGHT = 28;
/** 拖动时边缘的感应宽度（像素）。 */
const EDGE_PX = 6;
const DRAG_PX = 3;

const icon = iconStyle({ size: 'XS' });
const label = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: 'ui-xs', color: 'gray-700' });
const block = style({
  position: 'absolute',
  top: 4,
  bottom: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 4,
  borderRadius: 'sm',
  font: 'ui-xs',
  fontWeight: 'bold',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  borderStyle: 'solid',
  borderWidth: 1,
  cursor: 'grab',
  backgroundColor: { default: 'purple-200', isEdited: 'purple-300', isManual: 'indigo-200' },
  borderColor: { default: 'purple-500', isManual: 'indigo-500', isSelected: 'blue-900' },
  color: 'gray-900',
  outlineStyle: 'none',
});
const edge = style({ position: 'absolute', top: 0, bottom: 0, width: 8, cursor: 'ew-resize' });
const ghost = style({
  position: 'absolute',
  top: 4,
  bottom: 4,
  borderRadius: 'sm',
  borderStyle: 'dashed',
  borderWidth: 1,
  borderColor: 'purple-600',
  backgroundColor: 'purple-100',
  pointerEvents: 'none',
});
const clickMark = style({ position: 'absolute', top: 8, bottom: 8, width: 2, borderRadius: 'full', backgroundColor: 'orange-700' });
const span = style({ position: 'absolute', top: 12, height: 4, borderRadius: 'full', backgroundColor: 'gray-200' });

/** 一条轨道上用屏幕取景的那几份文档（一次录制一份；同一轨道上可能有好几次录制）。 */
export function screenViewLanes(sequence: Sequence, trackId: Id): Id[] {
  const ids = new Set<Id>();
  for (const item of sequence.items) if (item.trackId === trackId && item.type === 'video' && item.screenView) ids.add(item.screenView.documentId);
  return [...ids];
}

interface RowProps {
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  documentId: Id;
  rowClass: string;
  headerClass: string;
  laneClass: string;
  laneWidth: number;
  /** 序列时间（秒）→ 轨道内容里的横坐标。 */
  xOf(seconds: number): number;
  /** 每秒多少像素。 */
  pps: number;
  editable: boolean;
  onSeek(seconds: number): void;
}

/** 屏幕实例的「缩放」与「鼠标」两行。 */
export function ScreenViewRows(props: RowProps) {
  const state = useScreenView(props.documents, props.documentId);
  const { view, recording } = state;
  const items = screenItems(props.sequence, props.documentId);
  const first = items[0];
  const clocks = useMemo(() => {
    if (!view || !first) return [];
    const offset = contentOffset(view, recording, first.assetRef.id);
    return items.map((item) => contentClock(item, props.sequence, offset)).filter((clock): clock is ContentClock => clock !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- items 由 sequence 与 documentId 决定
  }, [view, recording, props.sequence, props.documentId]);
  if (!view || !first) return null;
  const pointer = recording?.streams.find((stream) => stream.role === 'pointer');
  return (
    <>
      <ZoomRow {...props} state={state} clocks={clocks} />
      {pointer && recording && recording.pointer?.mode !== 'none' ? (
        <MouseRow
          {...props}
          clocks={clocks}
          asset={pointer.assetRef}
          start={ticksToSeconds(pointer.start, recording.timescale)}
          screenItemId={first.id}
        />
      ) : null}
    </>
  );
}

type Drag =
  | { kind: 'create'; originX: number; from: number; to: number; clock: ContentClock; started: boolean }
  | { kind: 'move' | 'start' | 'end'; originX: number; placed: PlacedZoom; clock: ContentClock; dx: number; started: boolean };

function ZoomRow({
  sequence,
  documentId,
  rowClass,
  headerClass,
  laneClass,
  laneWidth,
  xOf,
  pps,
  editable,
  onSeek,
  state,
  clocks,
}: RowProps & { state: ReturnType<typeof useScreenView>; clocks: ContentClock[] }) {
  const view = state.view!;
  const selected = useScreenViewSelection((s) => (s.selected?.documentId === documentId ? s.selected.zoomId : null));
  const select = useScreenViewSelection((s) => s.select);
  const [drag, setDrag] = useState<Drag | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const placed = useMemo(() => placeZooms(view, clocks), [view, clocks]);

  const timeAt = (clientX: number) => {
    const rect = laneRef.current?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : 0;
    // xOf 是线性的：用两点反解。
    const x0 = xOf(0);
    const x1 = xOf(1);
    return (x - x0) / (x1 - x0 || 1);
  };
  const clockAt = (time: number) => clocks.find((clock) => time >= clock.start && time < clock.end) ?? null;

  const onLanePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const time = timeAt(event.clientX);
    const clock = clockAt(time);
    select(null);
    if (!editable || !clock) {
      onSeek(Math.max(0, time));
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ kind: 'create', originX: event.clientX, from: time, to: time, clock, started: false });
  };

  const onBlockPointerDown = (event: ReactPointerEvent<HTMLDivElement>, p: PlacedZoom) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    select({ documentId, zoomId: p.zoom.id });
    laneRef.current?.focus();
    const clock = clocks.find((c) => c.item.id === p.itemId);
    if (!editable || !clock) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const kind = x <= EDGE_PX && !p.clipStart ? 'start' : x >= rect.width - EDGE_PX && !p.clipEnd ? 'end' : 'move';
    laneRef.current?.setPointerCapture(event.pointerId);
    setDrag({ kind, originX: event.clientX, placed: p, clock, dx: 0, started: false });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.originX;
    const started = drag.started || Math.abs(dx) >= DRAG_PX;
    if (drag.kind === 'create') {
      const time = Math.min(drag.clock.end, Math.max(drag.clock.start, timeAt(event.clientX)));
      setDrag({ ...drag, to: time, started });
    } else setDrag({ ...drag, dx, started });
  };

  const onPointerUp = () => {
    const done = drag;
    setDrag(null);
    if (!done) return;
    if (!done.started) {
      if (done.kind === 'create') onSeek(Math.max(0, done.from));
      else onSeek(done.placed.start);
      return;
    }
    if (done.kind === 'create') {
      const a = done.clock.toContent(Math.min(done.from, done.to));
      const b = done.clock.toContent(Math.max(done.from, done.to));
      const added = addZoomChange(view, a, b);
      if (added) {
        state.patch([added.change]);
        select({ documentId, zoomId: added.id });
      }
      return;
    }
    const { t0, t1 } = zoomSeconds(view, done.placed.zoom);
    // 像素 → 序列秒 → 内容秒（变速的实例按它的速率换算）。
    const rate = done.clock.toContent(1) - done.clock.toContent(0);
    const delta = (done.dx / pps) * rate;
    const patch = done.kind === 'move' ? { t0: t0 + delta, t1: t1 + delta } : done.kind === 'start' ? { t0: t0 + delta } : { t1: t1 + delta };
    if (done.kind === 'move') {
      // 整段挪动时长度不变：撞到邻居就停在邻居那里。
      const length = t1 - t0;
      const index = view.zooms.findIndex((z) => z.id === done.placed.zoom.id);
      const prev = view.zooms[index - 1];
      const next = view.zooms[index + 1];
      const min = prev ? ticksToSeconds(prev.t1, view.timescale) : 0;
      const max = next ? ticksToSeconds(next.t0, view.timescale) : Number.POSITIVE_INFINITY;
      const from = Math.min(Math.max(min, patch.t0!), max - length);
      state.patch(zoomChanges(view, done.placed.zoom.id, { t0: from, t1: from + length }));
      return;
    }
    state.patch(zoomChanges(view, done.placed.zoom.id, patch));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!selected || !editable) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      state.patch([removeZoomChange(selected)]);
      select(null);
    } else if (event.key === 'Escape') {
      select(null);
    }
  };

  const shown = (p: PlacedZoom): { left: number; right: number } => {
    let left = xOf(p.start);
    let right = xOf(p.end);
    if (drag && drag.kind !== 'create' && drag.started && drag.placed.key === p.key) {
      if (drag.kind === 'move' || drag.kind === 'start') left += drag.dx;
      if (drag.kind === 'move' || drag.kind === 'end') right += drag.dx;
    } else if (drag && drag.kind !== 'create' && drag.started && drag.placed.zoom.id === p.zoom.id && drag.kind === 'move') {
      left += drag.dx;
      right += drag.dx;
    }
    return { left, right: Math.max(left + 2, right) };
  };

  return (
    <div className={rowClass} style={{ height: SCREEN_VIEW_ROW_HEIGHT }}>
      <div className={headerClass} onPointerDown={(event) => event.stopPropagation()}>
        <ZoomIn styles={icon} />
        <span className={label} title={SV.zoomRowTip}>
          {SV.zoomRow}
        </span>
      </div>
      <div
        ref={laneRef}
        className={laneClass}
        style={{ width: laneWidth, outline: 'none' }}
        tabIndex={-1}
        aria-label={SV.zoomRow}
        title={SV.zoomRowTip}
        onPointerDown={onLanePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={() => setDrag(null)}
        onKeyDown={onKeyDown}>
        {clocks.map((clock) => (
          <span key={clock.item.id} className={span} style={{ left: xOf(clock.start), width: Math.max(0, xOf(clock.end) - xOf(clock.start)) }} />
        ))}
        {placed.map((p) => {
          const { left, right } = shown(p);
          const isSelected = p.zoom.id === selected;
          return (
            <div
              key={p.key}
              role="button"
              aria-pressed={isSelected}
              aria-label={`${SV.zoomRow} ${p.zoom.scale}×`}
              className={block({ isSelected, isManual: p.zoom.origin === 'manual', isEdited: !!p.zoom.edited })}
              style={{ left, width: right - left, zIndex: isSelected ? 2 : 1 }}
              onPointerDown={(event) => onBlockPointerDown(event, p)}>
              {!p.clipStart ? <span className={edge} style={{ left: 0 }} /> : null}
              {right - left > 28 ? `${Math.round(p.zoom.scale * 100) / 100}×` : null}
              {!p.clipEnd ? <span className={edge} style={{ right: 0 }} /> : null}
            </div>
          );
        })}
        {drag?.kind === 'create' && drag.started ? (
          <span className={ghost} style={{ left: xOf(Math.min(drag.from, drag.to)), width: Math.abs(xOf(drag.to) - xOf(drag.from)) }} />
        ) : null}
      </div>
    </div>
  );
}

/** 指针轨里按下的时刻（素材自己的时钟，秒）；取不到时是空表。 */
function usePointerClicks(asset: VersionRef): number[] {
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const { url } = useAssetUrl(videoId, asset);
  const [clicks, setClicks] = useState<number[]>([]);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url, { headers: { accept: POINTER_TRACK_MEDIA_TYPE } })
      .then((response) => (response.ok ? (response.json() as Promise<PointerTrack>) : null))
      .then((track) => {
        if (cancelled || !track || !Array.isArray(track.buttons) || !(track.timescale > 0)) return;
        setClicks(track.buttons.filter(([, , down]) => down === 1).map(([t]) => t / track.timescale));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url]);
  return clicks;
}

function MouseRow({
  rowClass,
  headerClass,
  laneClass,
  laneWidth,
  xOf,
  clocks,
  asset,
  start,
  screenItemId,
}: RowProps & { clocks: ContentClock[]; asset: VersionRef; start: number; screenItemId: Id }) {
  const clicks = usePointerClicks(asset);
  // 指针轨的源时间 `s` 对应录制时间 `start + s`，再经各个屏幕实例投到序列上。
  const marks = clocks.flatMap((clock) =>
    clicks.flatMap((t) => {
      const time = clock.toSequence(start + t);
      return time >= clock.start && time < clock.end ? [{ key: `${clock.item.id}:${t}`, time }] : [];
    }),
  );
  const open = (event: ReactPointerEvent) => {
    event.stopPropagation();
    if (event.button === 0) useEditor.getState().select([screenItemId]);
  };
  return (
    <div className={rowClass} style={{ height: SCREEN_VIEW_ROW_HEIGHT }}>
      <div className={headerClass} onPointerDown={open}>
        <CursorClick styles={icon} />
        <span className={label} title={SV.mouseRowTip}>
          {SV.mouseRow}
        </span>
      </div>
      <div className={laneClass} style={{ width: laneWidth }} title={SV.mouseRowTip} onPointerDown={open}>
        {clocks.map((clock) => (
          <span key={clock.item.id} className={span} style={{ left: xOf(clock.start), width: Math.max(0, xOf(clock.end) - xOf(clock.start)) }} />
        ))}
        {marks.map((mark) => (
          <span key={mark.key} className={clickMark} style={{ left: xOf(mark.time) - 1 }} aria-label={SV.click} role="img" />
        ))}
      </div>
    </div>
  );
}
