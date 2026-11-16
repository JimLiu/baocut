import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Id, ScreenViewBody, Sequence, VideoItem } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { cropRect, draggedFocus, focusView, rectQuad, type FrameLayer } from '../../model/screen-focus-frame.ts';
import { patchView, readScreenView, screenItems, zoomChanges } from '../../model/screen-view.ts';
import type { Point } from '../../model/stage-pose.ts';
import { isMediaLayer, stageLayers } from '../../render/frame-plan.ts';
import { useEditor, type DocumentDraft } from '../../state/editor-store.ts';
import { useScreenViewSelection } from '../../state/screen-view-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { SCREEN_VIEW_COPY as SV } from './screen-view-copy.ts';
import type { View } from './stage-boxes.tsx';
import { useDocumentBody } from './use-document-body.ts';

/**
 * 舞台上的取景框（屏幕录制设计 §5「固定看一点时在舞台上拖取景框」）：选中一段「固定看一点」的缩放、停着、能改时，
 * 在屏幕实例的画面上画出这一段放大到最大时看得见的区域（model/screen-focus-frame，与渲染同一套求值），拖它改取景点。
 *
 * - 框画在不放大的整幅画面上：框显示期间预览用一份去掉所有缩放的取景文档草稿（`documentDraft`，只给预览，检查器不看），
 *   否则播放头落在缩放里时画面已经放大，框对不上画面。框收起（取消选中、起播、换成跟随鼠标）时丢掉这份草稿。
 *   别的拖动（字幕样式）临时占了草稿时不抢，等它放开再放回来。
 * - 拖动中只改本地的框，松手写一笔 `zooms[].focus`；自动生成的区间同时记 `edited`（`zoomChanges`）。框夹在裁剪里，拖不出画面。
 * - 画面上没有用这份取景文档的屏幕实例（这一刻在别处、被分屏）时不画。
 */

const overlay = style({ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none', color: 'blue-800' });
const shade = style({ color: 'transparent-black-400', pointerEvents: 'none' });

export function StageFocusFrame({ sequence, view }: { sequence: Sequence; view: View }) {
  const { engine, apply } = useEditorActions();
  const selected = useScreenViewSelection((s) => s.selected);
  const playing = useEditor((s) => s.playing);
  const editable = useVideo((s) => canEdit(s.video));
  const records = useVideo((s) => s.video?.state?.video.documents);
  const record = selected ? records?.[selected.documentId] : undefined;
  const body = useDocumentBody(record);
  // 提交之后新版本的正文还没取到时接着用上一版，框与草稿不闪一下。
  const last = useRef<{ documentId: Id; view: ScreenViewBody } | null>(null);
  const parsed = readScreenView(body);
  if (parsed && record) last.current = { documentId: record.id, view: parsed };
  const kept = body === undefined && last.current?.documentId === record?.id ? last.current : null;
  const screenView = parsed ?? kept?.view ?? null;
  const zoom = screenView?.zooms.find((z) => z.id === selected?.zoomId) ?? null;
  const point = zoom?.focus.kind === 'point' ? zoom.focus : null;

  const items = useMemo(() => (selected ? screenItems(sequence, selected.documentId) : []), [sequence, selected]);
  const [layer, setLayer] = useState<{ itemId: Id; geometry: FrameLayer } | null>(null);
  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    return engine.onPlan((plan) => {
      const found = stageLayers(plan).find((l) => ids.has(l.itemId) && isMediaLayer(l) && l.kind === 'video' && !l.panels?.length);
      const next = found && isMediaLayer(found) ? { itemId: found.itemId, geometry: { matrix: found.matrix, sourceRect: found.sourceRect } } : null;
      setLayer((prev) =>
        prev && next && prev.itemId === next.itemId && same(prev.geometry.matrix, next.geometry.matrix) && same(prev.geometry.sourceRect, next.geometry.sourceRect)
          ? prev
          : next,
      );
    });
  }, [engine, items]);
  const item = layer ? (items.find((i) => i.id === layer.itemId) as VideoItem | undefined) : undefined;
  const locked = !!item && (item.locked || !!sequence.tracks.find((t) => t.id === item.trackId)?.locked);
  const shown = !!(selected && record && screenView && zoom && point && item && layer && editable && !playing && !locked);

  // 框显示期间预览看整幅画面：去掉缩放的草稿（只在草稿槽空着或还是自己那份时放）。
  const mine = useRef<DocumentDraft | null>(null);
  const mineFrom = useRef<ScreenViewBody | null>(null);
  const draftSlot = useEditor((s) => s.documentDraft);
  useEffect(() => {
    if (!shown || !record || !screenView) return;
    const current = useEditor.getState().documentDraft;
    const fresh =
      current === mine.current &&
      mine.current?.documentId === record.id &&
      mine.current.baseRevision === record.currentRevision &&
      mineFrom.current === screenView;
    if (fresh || (current && current !== mine.current)) return;
    const draft: DocumentDraft = { documentId: record.id, baseRevision: record.currentRevision, body: { ...screenView, zooms: [] } };
    mine.current = draft;
    mineFrom.current = screenView;
    useEditor.getState().setDocumentDraft(draft);
  }, [shown, record, screenView, draftSlot]);
  useEffect(() => {
    if (shown) return;
    if (mine.current && useEditor.getState().documentDraft === mine.current) useEditor.setState({ documentDraft: null });
    mine.current = null;
  }, [shown]);
  useEffect(
    () => () => {
      if (mine.current && useEditor.getState().documentDraft === mine.current) useEditor.setState({ documentDraft: null });
    },
    [],
  );

  // 拖动：起手时的取景点与指针（画布像素），此刻拖到的取景点；松手后留着它，等新正文到了再放掉，免得框跳回去。
  const drag = useRef<{ pointerId: number; start: Point; from: Point } | null>(null);
  const [moved, setMoved] = useState<{ zoomId: Id; focus: Point } | null>(null);
  useEffect(() => setMoved(null), [point?.x, point?.y, zoom?.id]);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!shown || !screenView || !zoom || !point || !layer || !item || !selected) return null;
  const crop = cropRect(item.crop);
  const focus = moved?.zoomId === zoom.id ? moved.focus : point;
  const quad = rectQuad(layer.geometry, focusView(focus, zoom.scale, crop));
  const pts = quad.map((p) => `${p.x * view.kx},${p.y * view.ky}`).join(' ');
  const pictureQuad = rectQuad(layer.geometry, crop)
    .map((p) => `${p.x * view.kx},${p.y * view.ky}`)
    .join(' ');

  const toCanvas = (event: PointerEvent): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (event.clientX - r.left) / view.kx, y: (event.clientY - r.top) / view.ky };
  };
  const onPointerDown = (event: PointerEvent<SVGPolygonElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, start: focus, from: toCanvas(event) };
  };
  const onPointerMove = (event: PointerEvent<SVGPolygonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    event.stopPropagation();
    setMoved({ zoomId: zoom.id, focus: draggedFocus(layer.geometry, d.start, d.from, toCanvas(event), zoom.scale, crop) });
  };
  const onPointerUp = (event: PointerEvent<SVGPolygonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    const next = draggedFocus(layer.geometry, d.start, d.from, toCanvas(event), zoom.scale, crop);
    const changes = zoomChanges(screenView, zoom.id, { focus: { kind: 'point', x: round(next.x), y: round(next.y) } });
    if (!changes.length) {
      setMoved(null);
      return;
    }
    setMoved({ zoomId: zoom.id, focus: next });
    void apply([patchView(selected.documentId, changes)]).then((receipt) => {
      if (!receipt) setMoved(null);
    });
  };
  const onPointerCancel = () => {
    drag.current = null;
    setMoved(null);
  };

  return (
    <svg ref={svgRef} className={overlay} width="100%" height="100%" data-focus-frame>
      {/* 框外压暗（整幅画面减去框），框是白底蓝线：花哨的屏幕画面上也看得清。 */}
      <path className={shade} d={`M${pictureQuad}Z M${pts}Z`} fillRule="evenodd" fill="currentColor" />
      <polygon points={pts} fill="none" stroke="white" strokeWidth={4} />
      <polygon
        points={pts}
        role="img"
        aria-label={SV.focusFrame}
        fill="rgba(0, 0, 0, 0.001)"
        stroke="currentColor"
        strokeWidth={2}
        style={{ pointerEvents: 'all', cursor: drag.current ? 'grabbing' : 'move' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    </svg>
  );
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 1e-9);
/** 写进文档的取景点留 4 位小数（够画面上的一个像素），免得每次拖动都落一串浮点尾数。 */
const round = (v: number) => Math.round(v * 1e4) / 1e4;
