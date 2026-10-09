import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import type { CaptionItem, DocumentRecord, Id, Place, Revision, Sequence, SequenceItem } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { STAGE_COPY } from '../../copy.ts';
import { captionKind } from '../../model/caption-tracks.ts';
import { applyDrafts, type ItemDraft } from '../../model/item-draft.ts';
import { DEFAULT_CAPTION_STYLE, captionStyleRoot } from '../../model/property-values.ts';
import {
  CAPTION_X,
  CAPTION_Y,
  captionBox,
  lineMoveStart,
  movedCaptionStyle,
  movedLineStyle,
  restackedRootY,
  stepCaptionMove,
  type CaptionMove,
  type CaptionMoveFrame,
} from '../../model/stage-caption-move.ts';
import {
  gestureOperations,
  gesturePatch,
  memberOf,
  membersOf,
  nudgeOperations,
  resetRotation,
  stepGesture,
  type Gesture,
  type GestureFrame,
  type Modifiers,
  type StageEnv,
} from '../../model/stage-gesture.ts';
import { hitAt, isMainVideo, marqueeHits, marqueeSelection, visibleItems } from '../../model/stage-hit.ts';
import {
  DEAD_ZONE,
  aabbOf,
  boundsOf,
  boxRect,
  cornerScales,
  isPlaced,
  marqueeRect,
  nudgeDelta,
  pivotOf,
  poseContains,
  poseOf,
  resizeKindOf,
  type CanvasSize,
  type Guide,
  type Handle,
  type PlacedItem,
  type Point,
  type Pose,
  type Rect,
} from '../../model/stage-pose.ts';
import type { CaptionHit } from '../../render/render-planner.ts';
import { num, type Json } from '../../render/text-style.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { openGallery } from './caption-gallery.tsx';
import { previewCaptionStyle, saveCaptionStyle } from './caption-style-edit.ts';
import { draftedBody } from './draft-documents.ts';
import { useEditorActions } from './editor-context.tsx';
import type { PreviewEngine } from './preview-engine.ts';
import { GroupBox, Guides, ItemBox, Marquee, ThinBox, type View } from './stage-boxes.tsx';
import { StageTextEdit } from './stage-text-edit.tsx';
import { StageToolbar } from './stage-toolbar.tsx';
import { focusDocument } from './transcribe-run.ts';
import { openFlow, setCompare } from './translate-run.ts';

/**
 * 舞台叠加层（原型 stage-objects.jsx、stage-marquee.jsx、stage.jsx）：盖在预览画布上，接画面上的点选、多选、拖动、
 * 改大小、旋转、框选、双击改字与方向键微调。
 *
 * - 点选按帧计划的层几何算（`stage-hit`）：看得见的才点得中；没选中的主视频不挡点选，在它上面按下拖动是框选，
 *   不动松手才选中它。⇧ / ⌘ 单击切换多选（主视频不进多选），点空白清空。
 * - 拖动中只改草稿：单件走 store 的草稿（预览与属性页一起跟手）；多件用引擎的临时覆盖（属性页不跟），
 *   松手按起手状态算出的终值提交**一笔**事务，失败就回到原值。真的动过才吞掉随后补发的 click。
 * - 字幕没有 `place`，按在它上面拖动是挪字幕样式的水平中心与锚线（原型 stage.jsx 的字幕 SelectionBox，见 model/stage-caption-move）：
 *   拖动中走 store 的文档草稿（预览与属性页一起跟手），松手写入样式文档，用同一份样式的字幕一起动。双语时只拖选中的那一行
 *   （原型里每条字幕轨各拖各的），框选或 ⇧ / ⌘ 单击把两行都选上再拖才整组动（框选同时框到画面元素时只留元素）。
 * - 只读、锁定或正在播放时不出把手，只读时点选照常；播放中按下画面只暂停（原型 stage.jsx），停下后再点选。
 */

const root = style({ position: 'absolute', inset: 0, outlineStyle: 'none', userSelect: 'none', touchAction: 'none' });
const space = style({ position: 'absolute' });

/** 画面在舞台里的位置与显示尺寸（舞台像素）。 */
export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const LABEL: Record<Gesture['kind'], string> = {
  move: STAGE_COPY.move,
  edge: STAGE_COPY.resize,
  corner: STAGE_COPY.scale,
  rotate: STAGE_COPY.rotate,
  'group-move': STAGE_COPY.groupMove,
  'group-scale': STAGE_COPY.groupScale,
};

/**
 * 拖字幕：起手时的样式文档、正文与根样式，拖到某处时根样式变成什么（整组挪根样式，双语单拖一行写那一行的覆盖），
 * 起手时拖的那些行的行框（拖动中平移着画，预览重画回来的行框会晚一拍）。`remember` 是松手后记进新字幕选项：
 * 单拖一行的位置在行覆盖里，新字幕选项不记它，为了另一行不跳而挪的根样式锚线也不该记。
 */
interface CaptionDrag {
  move: CaptionMove;
  record: DocumentRecord | undefined;
  body: unknown;
  root: Json;
  restyle: (to: { x: number; y: number }) => Json;
  remember: boolean;
  hits: CaptionHit[];
}

/** 一次按下：过了阈值做什么（几何手势、拖字幕或框选），没动就松手算一次点击做什么。 */
interface Press {
  pointerId: number;
  client0: Point;
  frame: DOMRect;
  env: StageEnv;
  gesture: Gesture | null;
  caption: CaptionDrag | null;
  marquee: { additive: boolean } | null;
  click: () => void;
  moved: boolean;
  queued: { p: Point; mods: Modifiers } | null;
  raf: number;
}

/** 拖动多件时的临时盒：手势中一直用；松手提交后用到新版本到达为止。 */
interface Override {
  poses: Map<Id, Pose>;
  until: Revision | null;
}

const toCanvas = (canvas: CanvasSize, frame: DOMRect, clientX: number, clientY: number): Point => ({
  x: ((clientX - frame.left) * canvas.width) / frame.width,
  y: ((clientY - frame.top) * canvas.height) / frame.height,
});

const modsOf = (event: { shiftKey: boolean; altKey: boolean }): Modifiers => ({ shift: event.shiftKey, alt: event.altKey });

/** 浏览器在 pointerup 之后还会补发一次 click：真的拖过时吞掉它，免得落到别处把选中清掉（原型 swallowDrag）。 */
function swallowClick(): void {
  const stop = (event: globalThis.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', stop, true), 0);
}

/** 这一帧画面上有哪些实例（随帧计划更新，没变就不重渲染）。 */
function useVisibleItems(engine: PreviewEngine): Id[] {
  const [ids, setIds] = useState<Id[]>([]);
  useEffect(
    () =>
      engine.onPlan((plan) => {
        const next = visibleItems(plan.layers);
        setIds((prev) => (prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next));
      }),
    [engine],
  );
  return ids;
}

export function StageObjects({ sequence, frame }: { sequence: Sequence; frame: FrameRect }) {
  const { engine, apply, pause } = useEditorActions();
  const documents = useRuntime().videos.documents;
  const selection = useEditor((s) => s.selection);
  const playing = useEditor((s) => s.playing);
  const editable = useVideo((s) => canEdit(s.video));
  const visible = useVisibleItems(engine);
  const [captionHits, setCaptionHits] = useState<readonly CaptionHit[]>([]);
  useEffect(() => engine.onCaptionHits(setCaptionHits), [engine]);
  const rootRef = useRef<HTMLDivElement>(null);
  const spaceRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const latest = useRef(sequence);
  latest.current = sequence;
  const nudges = useRef({ inflight: 0, at: new Map<Id, Place>() });
  const [active, setActive] = useState<Gesture['kind'] | 'marquee' | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [angle, setAngle] = useState<number | null>(null);
  const [override, setOverride] = useState<Override | null>(null);
  const [editing, setEditing] = useState<Id | null>(null);
  const [captionShift, setCaptionShift] = useState<{ hits: CaptionHit[]; dx: number; dy: number } | null>(null);

  const canvas = sequence.canvas;
  // 媒体框的高按源的宽高比推，要查素材表。
  const assets = useVideo((s) => s.video?.state?.video.assets);
  const view: View = { kx: frame.width / canvas.width, ky: frame.height / canvas.height };
  const byId = useMemo(() => new Map(sequence.items.map((item) => [item.id, item])), [sequence]);
  const locked = (item: SequenceItem) => item.locked || !!sequence.tracks.find((t) => t.id === item.trackId)?.locked;
  const changeable = (item: SequenceItem) => editable && !playing && !locked(item);
  const isMain = (id: Id) => {
    const item = byId.get(id);
    return !!item && isMainVideo(item, sequence);
  };

  // 多件拖动的临时盒：手势中一直用，提交后等到新版本到达就作废。
  const overridePoses = override && (override.until === null || override.until === sequence.revision) ? override.poses : null;
  useEffect(() => {
    if (override?.until != null && override.until !== sequence.revision) setOverride(null);
  }, [override, sequence.revision]);
  const poseFor = (item: PlacedItem) => overridePoses?.get(item.id) ?? poseOf(item, canvas, assets);

  // 选中的、此刻画面上有的、有布局框的那几件。改字中的文字在画布上藏着（不在帧计划里），照样算。
  const onStage = new Set(visible);
  if (editing) onStage.add(editing);
  const picked = selection
    .map((id) => byId.get(id))
    .filter((item): item is PlacedItem => !!item && isPlaced(item) && onStage.has(item.id));
  const others = picked.filter((item) => !isMainVideo(item, sequence));
  const single = picked.length === 1 ? picked[0]! : others.length === 1 ? others[0]! : null;
  const group = !single && others.length >= 2 ? others : null;
  const groupBounds = group ? boundsOf(group.map((item) => aabbOf(poseFor(item)))) : null;
  const groupChangeable = !!group && group.every(changeable);

  // ---- 引擎的临时覆盖（多件拖动、改字时藏起画布上的那段字） ----

  const paintSequence = (seq: Sequence) => {
    const snapshot = useVideo.getState().video?.state?.video;
    if (snapshot) engine.setVideo(seq, snapshot.assets, snapshot.documents);
  };
  const paint = (drafts: ItemDraft[]) => paintSequence(applyDrafts(latest.current, drafts));
  const restore = () => paint([]);

  // 改字中：画布上那段字一露出来（别处重新给了引擎序列）就再藏一次。放到微任务里，等引擎这一轮同步完。
  // 藏的是哪一件记在 ref 里，结束改字时同步清掉，免得提交那一刻画上去的新字又被藏回去。
  const hidden = useRef<Id | null>(null);
  useEffect(() => {
    if (!editing) return;
    hidden.current = editing;
    const stop = engine.onPlan((plan) => {
      if (hidden.current !== editing || !plan.layers.some((layer) => layer.itemId === editing)) return;
      queueMicrotask(() => {
        const seq = latest.current;
        if (hidden.current === editing && seq.items.some((item) => item.id === editing))
          paint([{ itemId: editing, revision: seq.revision, patch: { place: { opacity: 0 } } }]);
      });
    });
    return () => {
      stop();
      if (hidden.current === editing) hidden.current = null;
    };
    // paint 只读 ref 与 store，不随渲染变，不进依赖。
  }, [engine, editing]);
  useEffect(() => {
    if (editing && !byId.has(editing)) setEditing(null);
  }, [editing, byId]);

  // ---- 选中 ----

  const select = (ids: Id[]) => useEditor.getState().select(ids);
  /** ⇧ / ⌘ 单击：切换这一件；主视频不进多选。 */
  const toggle = (id: Id) => {
    if (isMain(id)) return;
    const current = useEditor.getState().selection;
    select(current.includes(id) ? current.filter((x) => x !== id) : [...current.filter((x) => !isMain(x)), id]);
  };
  const hitTest = (p: Point) => {
    const selected = new Set(useEditor.getState().selection);
    const boxes = new Map(picked.map((item) => [item.id, poseFor(item)]));
    return hitAt(engine.plan?.layers ?? [], p, {
      captionHits: engine.captionHits,
      skip: (id) => isMain(id) && !selected.has(id),
      boxes,
      contains: poseContains,
    });
  };
  /** 吸附参照：画面上其它有布局框的实例（主视频除外，它的边就是画布的边）。 */
  const snapRects = (exclude: Set<Id>): Rect[] =>
    visible.flatMap((id) => {
      const item = byId.get(id);
      return item && isPlaced(item) && !exclude.has(id) && !isMainVideo(item, sequence) ? [boxRect(poseOf(item, canvas, assets))] : [];
    });

  // ---- 手势 ----

  /** 把这一步画出来；`live` 是手势还在进行（出参考线与角度气泡），松手提交时只画终值。 */
  const show = (gesture: Gesture, result: GestureFrame, live = true) => {
    const seq = latest.current;
    const members = membersOf(gesture);
    if ('members' in gesture) {
      paint(
        members.map((m, i) => ({
          itemId: m.item.id,
          revision: seq.revision,
          patch: gesturePatch(m.item, result.poses[i]!, result.factor, seq.canvas, assets),
        })),
      );
      setOverride({ poses: new Map(members.map((m, i) => [m.item.id, result.poses[i]!])), until: null });
    } else {
      const m = members[0]!;
      useEditor.getState().setDraft({
        itemId: m.item.id,
        revision: seq.revision,
        patch: gesturePatch(m.item, result.poses[0]!, result.factor, seq.canvas, assets),
      });
    }
    setGuides(live ? result.guides : []);
    setAngle(live && gesture.kind === 'rotate' ? result.poses[0]!.rotation : null);
  };

  const discard = (gesture: Gesture) => {
    if ('members' in gesture) {
      setOverride(null);
      restore();
    } else useEditor.getState().clearDrafts();
  };

  const commit = (gesture: Gesture, result: GestureFrame) => {
    const seq = latest.current;
    const operations = gestureOperations(seq.id, membersOf(gesture), result.poses, result.factor, seq.canvas);
    if (!operations.length) return discard(gesture);
    show(gesture, result, false);
    if ('members' in gesture) setOverride((o) => (o ? { ...o, until: seq.revision } : o));
    void apply(operations, LABEL[gesture.kind]).then((receipt) => {
      if (!receipt) discard(gesture);
    });
  };

  // ---- 拖字幕 ----

  /**
   * 按在一件字幕上：样式正文此刻在手、要拖的行此刻画在画面上，才起手。`group` 是两行都选中了（整组动）；否则同一份样式
   * 在这一帧里原文、译文两种行都有（渲染器按双语排，见 frame-render 的 `compile`），只拖这一行。
   */
  const captionDragOf = (item: CaptionItem, p0: Point, group: boolean): CaptionDrag | null => {
    const records = useVideo.getState().video?.state?.video.documents ?? {};
    const record = item.styleDocumentId ? records[item.styleDocumentId] : undefined;
    if (item.styleDocumentId && !record) return null;
    const body = record
      ? draftedBody(useEditor.getState().documentDraft, record.id, record.currentRevision, documents.peek(record.id, record.currentRevision))
      : DEFAULT_CAPTION_STYLE;
    const root = body === undefined ? null : captionStyleRoot(body);
    if (!root) return null;
    const sharing = (id: Id) => {
      const other = byId.get(id);
      return other?.type === 'caption' && other.styleDocumentId === item.styleDocumentId ? other : null;
    };
    const lines = engine.captionHits.filter((hit) => sharing(hit.itemId));
    const own = captionKind(item.documentId, records);
    const paired = (engine.plan?.layers ?? []).some((layer) => {
      const other = layer.kind === 'caption' ? sharing(layer.itemId) : null;
      return !!other && captionKind(other.documentId, records) !== own;
    });
    if (paired && !group) {
      const hits = lines.filter((hit) => hit.itemId === item.id);
      const box = captionBox(hits);
      if (!box) return null;
      const canvas = latest.current.canvas;
      const { x0, y0, detached } = lineMoveStart(root, own, box, canvas);
      const rest = lines.filter((hit) => {
        const other = sharing(hit.itemId);
        return !!other && captionKind(other.documentId, records) !== own;
      });
      const anchorY = detached ? null : restackedRootY(root, own, rest, canvas);
      const restyle = (to: { x: number; y: number }) => movedLineStyle(root, own, to, detached, anchorY);
      return { move: { box, x0, y0, p0 }, record, body, root, restyle, remember: false, hits };
    }
    const box = captionBox(lines);
    if (!box) return null;
    const move = { box, x0: num(root.x, CAPTION_X), y0: num(root.y, CAPTION_Y), p0 };
    const selected = useEditor.getState().selection;
    const hits = lines.filter((hit) => (group ? selected.includes(hit.itemId) : hit.itemId === item.id));
    return { move, record, body, root, restyle: (to) => movedCaptionStyle(root, to), remember: true, hits };
  };

  const showCaption = (drag: CaptionDrag, result: CaptionMoveFrame) => {
    previewCaptionStyle(drag.record, drag.body, drag.restyle(result));
    setCaptionShift({ hits: drag.hits, dx: result.dx, dy: result.dy });
    setGuides(result.guides);
  };

  const commitCaption = (drag: CaptionDrag, result: CaptionMoveFrame) => {
    if (result.x === drag.move.x0 && result.y === drag.move.y0) return useEditor.getState().clearDrafts();
    const { record, body, root } = drag;
    const before = drag.remember ? root : null;
    saveCaptionStyle(apply, { sequence: latest.current, record, body, before, style: drag.restyle(result), label: STAGE_COPY.move });
  };

  const finishMarquee = (p: Press, clientX: number, clientY: number, additive: boolean) => {
    const seq = latest.current;
    const r = marqueeRect({ x: p.client0.x, y: p.client0.y }, { x: clientX, y: clientY });
    const corner = toCanvas(seq.canvas, p.frame, r.x, r.y);
    const scale = seq.canvas.width / p.frame.width;
    const rect = { x: corner.x, y: corner.y, w: r.w * scale, h: (r.h * seq.canvas.height) / p.frame.height };
    const candidates = visible.flatMap((id) => {
      const item = byId.get(id);
      return item && isPlaced(item) && !isMainVideo(item, seq) ? [{ id, rect: aabbOf(poseOf(item, seq.canvas, assets)) }] : [];
    });
    // 字幕按画出来的行框参与框选（一件字幕这一帧可能有几行，合成一个框）。
    const captions = [...new Set(engine.captionHits.map((hit) => hit.itemId))].flatMap((id) => {
      const rect = captionBox(engine.captionHits.filter((hit) => hit.itemId === id));
      return rect ? [{ id, rect }] : [];
    });
    const hits = marqueeHits([...candidates, ...captions], rect);
    const base = additive ? useEditor.getState().selection.filter((id) => !isMain(id)) : [];
    select(marqueeSelection(base, hits, (id) => byId.get(id)?.type === 'caption'));
  };

  const reset = () => {
    setActive(null);
    setCaptionShift(null);
    setGuides([]);
    setAngle(null);
    setMarquee(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || press.current) return;
    const target = event.target as Element;
    // 工具条的弹层挂在 body 上，事件却沿 React 树冒泡到这里：不在叠加层里的一律不接（否则会抢走指针、拦掉输入框的聚焦）。
    if (!rootRef.current?.contains(target) || target.closest('[data-stage-editor]')) return;
    const rootEl = rootRef.current;
    const frameEl = spaceRef.current;
    if (!rootEl || !frameEl) return;
    event.preventDefault();
    rootEl.focus({ preventScroll: true });
    const fr = frameEl.getBoundingClientRect();
    if (!(fr.width > 0) || !(fr.height > 0)) return;
    const seq = latest.current;
    const p = toCanvas(seq.canvas, fr, event.clientX, event.clientY);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const hit = hitTest(p);
    // 没选中的主视频不挡点选；按在它上面、不动就松手，才选中它（原型：主视频只能点选）。
    const under = hit ?? hitAt(engine.plan?.layers ?? [], p, { captionHits: engine.captionHits });

    if (playing) {
      // 原型 stage.jsx：播放中按下画面只暂停，这一下的点击吞掉，不改选中、不起手势。
      pause();
      swallowClick();
      return;
    }

    const handleEl = target.closest<HTMLElement>('[data-handle]');
    const inGroup = !!target.closest('[data-group]');
    let gesture: Gesture | null = null;
    let caption: CaptionDrag | null = null;
    let marqueeMode: Press['marquee'] = null;
    let click = () => {};
    let moving = new Set<Id>();

    if (group && groupBounds && inGroup && handleEl) {
      if (groupChangeable)
        gesture = { kind: 'group-scale', members: group.map((item) => memberOf(item, seq.canvas, assets)), bounds: groupBounds, p0: p };
    } else if (single && handleEl) {
      const handle = handleEl.dataset.handle as Handle;
      const member = memberOf(single, seq.canvas, assets);
      gesture = { kind: cornerScales(resizeKindOf(single), handle) ? 'corner' : 'edge', member, handle, p0: p };
      moving = new Set([single.id]);
    } else if (single && target.closest('[data-rotate]')) {
      gesture = { kind: 'rotate', member: memberOf(single, seq.canvas, assets), pivot: pivotOf(single, seq.canvas, assets), p0: p };
    } else if (group && inGroup && !additive) {
      if (groupChangeable) gesture = { kind: 'group-move', members: group.map((item) => memberOf(item, seq.canvas, assets)), p0: p };
    } else if (hit && !additive) {
      // 按在一件上：没选中的先选中，拖动就移动它（原型要先选中才能拖；这里与常见剪辑器一致，按下即可拖）。
      // 选中的全是同一份样式的字幕（双语两行都框选或 ⇧ / ⌘ 点选上了）时按下不收成一件，拖动整组动；不动就松手才只留这一行。
      const item = byId.get(hit);
      const current = useEditor.getState().selection;
      const captionGroup =
        item?.type === 'caption' &&
        current.length > 1 &&
        current.includes(hit) &&
        current.every((id) => {
          const other = byId.get(id);
          return other?.type === 'caption' && other.styleDocumentId === item.styleDocumentId;
        });
      if (captionGroup) click = () => select([hit]);
      else if (!current.includes(hit) || current.length > 1) select([hit]);
      if (item?.type === 'caption') useEditor.getState().showPanel('props');
      if (item && isPlaced(item) && changeable(item)) gesture = { kind: 'move', member: memberOf(item, seq.canvas, assets), p0: p };
      else if (item?.type === 'caption' && changeable(item) && (!captionGroup || current.every((id) => changeable(byId.get(id)!))))
        caption = captionDragOf(item, p, captionGroup);
      moving = new Set([hit]);
    } else {
      // 空白、主视频面、或按着 ⇧ / ⌘：拖过 4px 起框选，不动松手是一次点击。
      marqueeMode = { additive };
      click = additive ? () => under && toggle(under) : () => select(under ? [under] : []);
    }

    press.current = {
      pointerId: event.pointerId,
      client0: { x: event.clientX, y: event.clientY },
      frame: fr,
      env: { canvas: seq.canvas, others: snapRects(moving), pxScale: seq.canvas.width / fr.width },
      gesture,
      caption,
      marquee: marqueeMode,
      click,
      moved: false,
      queued: null,
      raf: 0,
    };
    rootEl.setPointerCapture(event.pointerId);
  };

  /** 没在拖时：指针下有可点的实例就换成手形（选中框与把手有自己的光标）。 */
  const hover = (event: PointerEvent<HTMLDivElement>) => {
    const rootEl = rootRef.current;
    const frameEl = spaceRef.current;
    if (!rootEl || !frameEl || event.buttons) return;
    if (event.target !== rootEl && event.target !== frameEl) {
      rootEl.style.cursor = '';
      return;
    }
    const fr = frameEl.getBoundingClientRect();
    if (!(fr.width > 0)) return;
    const hit = hitTest(toCanvas(latest.current.canvas, fr, event.clientX, event.clientY));
    const item = hit ? byId.get(hit) : undefined;
    // 选中的字幕没有自己的选中框接指针：能拖时在这里换成移动光标。
    const movable = item?.type === 'caption' && changeable(item) && useEditor.getState().selection.includes(item.id);
    rootEl.style.cursor = movable ? 'move' : hit ? 'pointer' : '';
  };

  const flush = (p: Press) => {
    p.raf = 0;
    const queued = p.queued;
    if (!queued) return;
    p.queued = null;
    if (p.gesture) show(p.gesture, stepGesture(p.gesture, queued.p, queued.mods, p.env));
    else if (p.caption) showCaption(p.caption, stepCaptionMove(p.caption.move, queued.p, queued.mods, p.env));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return hover(event);
    if (event.pointerId !== p.pointerId) return;
    const dx = event.clientX - p.client0.x;
    const dy = event.clientY - p.client0.y;
    if (!p.moved) {
      if (p.gesture || p.caption) {
        if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
      } else if (!p.marquee || !marqueeRect(p.client0, { x: event.clientX, y: event.clientY }).on) return;
      p.moved = true;
      setActive(p.gesture?.kind ?? (p.caption ? 'move' : 'marquee'));
      if (p.caption && rootRef.current) rootRef.current.style.cursor = 'grabbing';
    }
    if (p.gesture || p.caption) {
      p.queued = { p: toCanvas(p.env.canvas, p.frame, event.clientX, event.clientY), mods: modsOf(event) };
      if (!p.raf) p.raf = requestAnimationFrame(() => flush(p));
      return;
    }
    const r = marqueeRect(p.client0, { x: event.clientX, y: event.clientY });
    setMarquee({ x: r.x - p.frame.left, y: r.y - p.frame.top, w: r.w, h: r.h });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || event.pointerId !== p.pointerId) return;
    press.current = null;
    if (p.raf) cancelAnimationFrame(p.raf);
    if (!p.moved) return p.click();
    swallowClick();
    reset();
    // 松开的位置也算上：快速拖动时浏览器会合并 pointermove。
    const at = toCanvas(p.env.canvas, p.frame, event.clientX, event.clientY);
    if (p.gesture) commit(p.gesture, stepGesture(p.gesture, at, modsOf(event), p.env));
    else if (p.caption) commitCaption(p.caption, stepCaptionMove(p.caption.move, at, modsOf(event), p.env));
    else if (p.marquee) finishMarquee(p, event.clientX, event.clientY, p.marquee.additive);
  };

  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || event.pointerId !== p.pointerId) return;
    press.current = null;
    if (p.raf) cancelAnimationFrame(p.raf);
    if (p.moved && p.gesture) discard(p.gesture);
    else if (p.moved && p.caption) useEditor.getState().clearDrafts();
    reset();
  };

  // ---- 双击：旋转钮归零；文字就地改 ----

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!rootRef.current?.contains(event.target as Node)) return;
    // 按下时根节点捕获了指针，随后的 click / dblclick 落在根节点上；按指针位置找真正点到的东西。
    const target = document.elementFromPoint(event.clientX, event.clientY) ?? (event.target as Element);
    if (target.closest('[data-stage-editor]') || target.closest('[data-handle]')) return;
    const seq = latest.current;
    const rotateEl = target.closest<HTMLElement>('[data-rotate]');
    if (rotateEl) {
      const item = byId.get(rotateEl.dataset.rotate ?? '');
      if (item && isPlaced(item) && changeable(item)) {
        const operations = resetRotation(seq.id, item);
        if (operations.length) void apply(operations, STAGE_COPY.rotateReset);
      }
      return;
    }
    const frameEl = spaceRef.current;
    if (!frameEl) return;
    const hit = hitTest(toCanvas(seq.canvas, frameEl.getBoundingClientRect(), event.clientX, event.clientY));
    const item = hit ? byId.get(hit) : undefined;
    if (item?.type === 'caption') {
      select([item.id]);
      const video = useVideo.getState().video;
      if (video?.videoId) {
        const records = video.state?.video.documents ?? {};
        const source = records[item.documentId]?.sourceDocumentId;
        const translation = source && records[source]?.kind === 'translation' ? source : null;
        setCompare(video.videoId, { mode: translation ? 'trans' : 'src', documentId: translation });
        openGallery(video.videoId, false);
        openFlow(video.videoId, false);
        focusDocument(video.videoId, item.documentId);
      }
      useEditor.getState().showPanel('subtitle');
      return;
    }
    if (!item || item.type !== 'text' || item.counter || !changeable(item)) return;
    select([item.id]);
    setEditing(item.id);
  };

  const endEdit = (id: Id, text: string | null, byKey: boolean) => {
    hidden.current = null;
    setEditing(null);
    if (byKey) rootRef.current?.focus({ preventScroll: true });
    if (text === null) return restore();
    // 新字先画上，不等回执（否则提交往返的这一下画面上是空的）。
    const seq = latest.current;
    paintSequence({ ...seq, items: seq.items.map((item) => (item.id === id && item.type === 'text' ? { ...item, text } : item)) });
    void apply([{ type: 'setText', sequenceId: latest.current.id, itemId: id, text }], STAGE_COPY.textEditor).then((receipt) => {
      if (!receipt) restore();
    });
  };

  // ---- 键盘：舞台有焦点时方向键微调（1%，⇧ 5%，⌥↑/↓ 0.1%；⌥←/→ 留给编辑器的时间微调） ----
  // 与编辑器快捷键（video-editor 的 useEditorKeys，挂在 window 冒泡段）的约定：舞台接了的方向键 preventDefault，
  // 编辑器见到 defaultPrevented 就不再移播放头；根节点带 `data-stage`，焦点在这里时编辑器的 ←/→ 也不移播放头。

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== rootRef.current || event.metaKey || event.ctrlKey || !editable) return;
    const seq = latest.current;
    const delta = nudgeDelta(event.key, event.shiftKey, event.altKey, seq.canvas);
    if (!delta) return;
    // 选中压过播放：有能推的就推，没有就让给编辑器（逐帧、播放中跳 5 秒）。
    const targets = picked.filter((item) => !isMainVideo(item, seq) && !locked(item));
    if (!targets.length) return;
    event.preventDefault();
    // 连按时上一笔还没回来：从上一笔的落点接着推，不从旧位置重算。
    const pending = nudges.current;
    const base = targets.map((item) => {
      const place = pending.at.get(item.id);
      return place ? ({ ...item, place } as PlacedItem) : item;
    });
    const operations = nudgeOperations(seq.id, base, delta, seq.canvas, assets);
    if (!operations.length) return;
    for (const operation of operations) {
      if (operation.type !== 'setTransform') continue;
      const from = base.find((item) => item.id === operation.itemId)!.place;
      pending.at.set(operation.itemId, { ...from, x: operation.x ?? from.x, y: operation.y ?? from.y });
    }
    pending.inflight += 1;
    void apply(operations, STAGE_COPY.nudge).finally(() => {
      pending.inflight -= 1;
      if (!pending.inflight) pending.at.clear();
    });
  };

  // ---- 画 ----

  const dragging = active === 'move' || active === 'group-move';
  const editingItem = editing ? byId.get(editing) : undefined;
  let boxes: ReactNode = null;
  if (editingItem?.type === 'text') {
    boxes = (
      <ItemBox
        id={editingItem.id}
        pose={poseFor(editingItem)}
        view={view}
        kind="text"
        video={false}
        controls={false}
        movable={false}
        dragging={false}
        angle={null}
      >
        <StageTextEdit item={editingItem} view={view} canvas={canvas} onDone={(text, byKey) => endEdit(editingItem.id, text, byKey)} />
      </ItemBox>
    );
  } else if (single) {
    const can = changeable(single);
    boxes = (
      <ItemBox
        id={single.id}
        pose={poseFor(single)}
        view={view}
        kind={resizeKindOf(single)}
        video={single.type === 'video'}
        controls={can}
        movable={can}
        dragging={dragging}
        angle={active === 'rotate' ? angle : null}
      />
    );
  } else if (group) {
    boxes = (
      <>
        {group.map((item) => (
          <ThinBox key={item.id} pose={poseFor(item)} view={view} />
        ))}
        {groupBounds && !playing ? (
          <GroupBox bounds={groupBounds} view={view} count={group.length} controls={groupChangeable} dragging={dragging} />
        ) : null}
      </>
    );
  }

  return (
    <div
      ref={rootRef}
      className={root}
      tabIndex={0}
      role="group"
      aria-label={STAGE_COPY.label}
      data-stage
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <div ref={spaceRef} className={space} style={frame}>
        {boxes}
        {(captionShift
          ? captionShift.hits.map((hit) => ({ ...hit, cx: hit.cx + captionShift.dx, cy: hit.cy + captionShift.dy }))
          : captionHits.filter((hit) => selection.includes(hit.itemId))
        ).map((hit, index) => (
          <ThinBox key={`${hit.itemId}:${hit.cueId}:${index}`} pose={hit} view={view} />
        ))}
        {marquee ? <Marquee rect={marquee} /> : null}
        <Guides guides={guides} view={view} />
      </div>
      {single && !editingItem && changeable(single) ? (
        <StageToolbar key={single.id} item={single} sequence={sequence} frame={frame} view={view} yielding={active !== null} />
      ) : null}
    </div>
  );
}
