import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type PointerEvent as ReactPointerEvent } from 'react';
import {
  newId,
  type AssetRecord,
  type DocumentRecord,
  type Id,
  type Sequence,
  type SequenceItem,
  type VideoAnnotationColor,
  type VideoAnnotationElement,
  type VideoAnnotationWidth,
} from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Button,
  Checkbox,
  createIcon,
  DialogContainer,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Text,
  TextArea,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import Brush from '@react-spectrum/s2/icons/Brush';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Close from '@react-spectrum/s2/icons/Close';
import Comment from '@react-spectrum/s2/icons/Comment';
import Select from '@react-spectrum/s2/icons/Select';
import TextIcon from '@react-spectrum/s2/icons/Text';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton, ToggleButton as RACToggleButton } from 'react-aria-components';
import { keyLabel } from '../../model/key-labels.ts';
import type { LiteSegment } from '../../model/lite-segments.ts';
import {
  MARKUP_COLORS,
  MARKUP_SHAPES,
  MARKUP_TEXT_SIZE,
  markFrames,
  MARKUP_WIDTHS,
  add,
  finishDrag,
  forget,
  fromGesture,
  handles,
  move,
  normalizedRect,
  pickElement,
  wantsLivePick,
  redo,
  remove,
  resize,
  select,
  sendable,
  setColor,
  setShape,
  setTool,
  setWidth,
  stepNumber,
  toNotes,
  undo,
  update,
  type Mark,
  type MarkInput,
  type MarkupHandle,
  type MarkupPick,
  type MarkupShape,
  type MarkupTool,
} from '../../model/lite-markup.ts';
import { stagePose } from '../../model/stage-framing.ts';
import { isPlaced, type Rect } from '../../model/stage-pose.ts';
import {
  VIDEO_ANNOTATION_NEAR_MS,
  videoAnnotationElementLabel,
  videoAnnotationErrorText,
  type DraftVideoAnnotation,
  type Point,
  type Size,
} from '../../model/video-annotations.ts';
import { readCaptions } from '../../render/captions.ts';
import { stageLayers } from '../../render/frame-plan.ts';
import type { CaptionHit } from '../../render/render-planner.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDraftImages, imageEntry } from '../../state/draft-images-store.ts';
import { useDraftVideoAnnotations } from '../../state/draft-video-annotations-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useLiteMarkup } from '../../state/lite-markup-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { LITE_MARKUP_COPY } from './lite-markup-copy.ts';
import { openVideoDraftKey } from './video-chat-draft.ts';

/*
 * 标记层与标记工具条（docs/design/lite-editor §4.1–§4.3；轻量与时间线两种视图同一套）：标注模式（舞台条的「标记」）下盖在画面上，
 * 画笔、形状、文字、选择元素与评论画在这一层；画面底上浮一条图标工具条。标记是这个窗口里的一组（state/lite-markup-store.ts），
 * 每条标记属于画它时的那一帧（播放头）：播放头离开那一帧（±`VIDEO_ANNOTATION_NEAR_MS`）就不画它，回来再画；画下去的那一刻从预览画布
 * 拷一份那一帧留在 store 里。按「添加到对话」整组换成视频标注草稿，每条带自己的时刻、那一刻的段与句，每一帧截一张图（那一帧的画面
 * 加上这一帧的标记）放进输入框；评论勾着「发给智能体」时单独立刻发出，图上画的是印章。已经进草稿的标注照旧由 StageNotesLayer 画
 * （这一层只画还没发的）。
 */

/** 拖动短于这么多像素算「点了一下」。 */
const MOVE_MIN = 4;
/** 线条的点选范围：至少这么宽，描边再粗就随描边。 */
const HIT_MIN = 12;
const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
/** 截图上印章的颜色（画布 2D 用不了 S2 的色票，取与 red-900 等相近的值）。 */
const SHOT_COLORS: Record<VideoAnnotationColor, string> = {
  red: '#d31510',
  blue: '#3b63fb',
  green: '#05834e',
  black: '#000000',
  white: '#ffffff',
};

type FrameRect = { left: number; top: number; width: number; height: number };

// ---- 样式 ----

/** 标记层铺满画面，接下所有手势（下面的舞台点选层与标注层在标注模式里都不接）。 */
const surface = style({ position: 'absolute', zIndex: 11, cursor: { default: 'crosshair', isPoint: 'cell', isPick: 'default' } });
const drawing = style({ position: 'absolute', inset: 0, width: 'full', height: 'full', overflow: 'visible', pointerEvents: 'none' });
const ink = style({
  color: { default: 'red-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
});
const hitStroke = style({ cursor: 'move' });
const pinMark = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 24,
  height: 24,
  paddingX: 4,
  boxSizing: 'border-box',
  borderRadius: 'full',
  transform: 'translate(-50%, -50%)',
  backgroundColor: { default: 'red-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  font: 'ui-xs',
  color: { default: 'white', tone: { red: 'white', blue: 'white', green: 'white', black: 'white', white: 'black' } },
  boxShadow: '[0 0 0 2px white]',
  fontWeight: 'bold',
  cursor: 'move',
  userSelect: 'none',
});
const textMark = style({
  position: 'absolute',
  whiteSpace: 'pre',
  fontWeight: 'bold',
  lineHeight: '[1.2]',
  color: { default: 'red-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  textShadow: { default: '[0 0 3px rgb(255 255 255 / 0.9)]', tone: { white: '[0 0 3px rgb(0 0 0 / 0.9)]' } },
  cursor: 'move',
  userSelect: 'none',
});
const textInput = style({
  position: 'absolute',
  minWidth: 120,
  padding: 0,
  margin: 0,
  borderStyle: 'dashed',
  borderWidth: 1,
  borderColor: 'gray-500',
  borderRadius: 'sm',
  backgroundColor: '[rgb(255 255 255 / 0.15)]',
  fontWeight: 'bold',
  lineHeight: '[1.2]',
  color: { default: 'red-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  outlineStyle: 'none',
});
/** 评论的印章：尖角落在那个点上（同 StageNotesLayer），写着评论人的缩写。 */
const stampMark = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 28,
  height: 28,
  paddingX: 4,
  boxSizing: 'border-box',
  borderRadius: 'full',
  borderBottomStartRadius: 'none',
  transform: 'translateY(-100%)',
  backgroundColor: { default: 'red-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  font: 'ui-xs',
  color: { default: 'white', tone: { red: 'white', blue: 'white', green: 'white', black: 'white', white: 'black' } },
  boxShadow: '[0 0 0 2px white, 0 1px 4px rgb(0 0 0 / 0.4)]',
  fontWeight: 'bold',
  cursor: 'move',
  userSelect: 'none',
});
const selection = style({
  position: 'absolute',
  boxSizing: 'border-box',
  borderStyle: 'dashed',
  borderWidth: 1,
  borderColor: 'blue-800',
  pointerEvents: 'none',
});
const handle = style({
  position: 'absolute',
  size: 12,
  boxSizing: 'border-box',
  transform: 'translate(-50%, -50%)',
  borderStyle: 'solid',
  borderWidth: 2,
  borderColor: 'blue-800',
  borderRadius: 'sm',
  backgroundColor: 'white',
  zIndex: 1,
});
/** 选择元素：悬停时的高亮框与说明卡（元素是什么、多大）。 */
const pickBox = style({
  position: 'absolute',
  boxSizing: 'border-box',
  borderStyle: 'solid',
  borderWidth: 2,
  borderColor: 'blue-800',
  backgroundColor: '[rgb(59 99 251 / 0.12)]',
  borderRadius: 'sm',
  pointerEvents: 'none',
});
const pickCard = style({
  position: 'absolute',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxWidth: 240,
  paddingX: 8,
  paddingY: 4,
  borderRadius: 'default',
  backgroundColor: 'layer-2',
  boxShadow: 'elevated',
  font: 'ui-xs',
  color: 'neutral',
  pointerEvents: 'none',
  zIndex: 2,
});
const pickLabel = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const pickSize = style({ color: 'gray-600', flexShrink: 0 });
/** HTML 节点卡：第一行选择器与尺寸并排，下面可访问性的标题与三行（左标签右值）。 */
const pickHead = style({ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 });
const pickHeading = style({ marginTop: 4, color: 'gray-600', font: 'ui-xs', fontWeight: 'bold' });
const pickRow = style({ display: 'flex', justifyContent: 'space-between', gap: 12, minWidth: 0 });
const anchorDot = style({ position: 'absolute', width: 1, height: 1, pointerEvents: 'none' });
const commentForm = style({ display: 'flex', flexDirection: 'column', gap: 12, width: 280, maxWidth: 'full' });
const commentActions = style({ display: 'flex', justifyContent: 'end', gap: 8 });
/** 工具条：浮在画面底边上方，居中；一行，浅底、圆角、细边、轻阴影（照截图标注器）。 */
const bar = style({
  position: 'absolute',
  zIndex: 12,
  transform: 'translate(-50%, -100%)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  boxSizing: 'border-box',
  padding: 4,
  borderRadius: 'lg',
  borderStyle: 'solid',
  borderWidth: 1,
  borderColor: 'gray-200',
  backgroundColor: 'layer-2',
  boxShadow: 'elevated',
});
const divider = style({ width: 1, height: 20, marginX: 4, backgroundColor: 'gray-300', flexShrink: 0 });
/**
 * 工具钮：安静的图标钮，24 方、图标 16，底色过渡 60ms 一档；当前工具浅蓝底、蓝图标（照原型的 `.ibtn.is-on`；
 * S2 的切换钮选中是灰底，所以用 RAC 的钮自己画）。带下拉的（形状 / 颜色 / 粗细）随内容加宽，图标右边多一枚小箭头；
 * 下拉打开时 RAC 把触发钮当按着，显示按下底色。
 */
const toolBtn = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  height: 24,
  minWidth: 24,
  boxSizing: 'border-box',
  paddingX: { default: 0, hasMenu: 4 },
  borderRadius: 'default',
  borderWidth: 0,
  backgroundColor: {
    default: 'transparent',
    isHovered: 'gray-100',
    isPressed: 'gray-200',
    isSelected: { default: 'blue-200', isHovered: 'blue-300' },
  },
  color: { default: 'gray-800', isSelected: 'blue-1000' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
  transition: 'default',
  transitionDuration: 60,
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  cursor: 'default',
  flexShrink: 0,
});
/** 工具钮上的图标：S 号（16）。 */
const toolIcon = iconStyle({ size: 'S' });
/** 颜色钮上的圆点，下拉里每行也是一枚。 */
const swatchDot = style({
  display: 'inline-block',
  size: 14,
  boxSizing: 'border-box',
  borderRadius: 'full',
  borderStyle: 'solid',
  borderWidth: 1,
  borderColor: 'gray-400',
  backgroundColor: { default: 'red-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  flexShrink: 0,
});
/** 下拉里一行的内容：样本（圆点 / 横线）与名字。 */
const menuRow = style({ display: 'inline-flex', alignItems: 'center', gap: 8 });
/** 带下拉的钮右边的小箭头：XS 号（12），一直是灰的，选中也不变蓝（外面套一层定色）。 */
const chevron = iconStyle({ size: 'XS' });
const chevronWrap = style({ display: 'inline-flex', color: 'gray-600', '--iconPrimary': { type: 'fill', value: 'currentColor' } });

// ---- 形状的图标（S2 没有对应的几个按原型的描边几何画在 20×20 网格上） ----

const LineGlyph = createIcon((props) => (
  <svg {...props} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
    <path d="M4 16L16 4" />
  </svg>
));
const ArrowGlyph = createIcon((props) => (
  <svg {...props} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 16L16 4" />
    <path d="M9 4h7v7" />
  </svg>
));
const BoxGlyph = createIcon((props) => (
  <svg {...props} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
    <rect x="3.5" y="5" width="13" height="10" rx="1" />
  </svg>
));
const EllipseGlyph = createIcon((props) => (
  <svg {...props} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <circle cx="10" cy="10" r="6.5" />
  </svg>
));
const PinGlyph = createIcon((props) => (
  <svg {...props} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="7" />
    <path d="M8.6 7.6L10.2 6.6V13.4" />
  </svg>
));
const SHAPE_GLYPHS: Record<MarkupShape, typeof LineGlyph> = {
  line: LineGlyph,
  arrow: ArrowGlyph,
  box: BoxGlyph,
  ellipse: EllipseGlyph,
  pin: PinGlyph,
};

/** 工具钮提示里的快捷键（按 macOS 写，别的平台换成 Ctrl+ 等）；撤销 / 重做 / 删选中的只有键（标记层接），不占钮。 */
const KEYS: Partial<Record<MarkupTool, string>> = { element: '⇧⌘S', comment: '⇧⌘C' };

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipTrigger placement="top">
      {children}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}

const pct = (v: number) => `${v * 100}%`;

/** 评论的一枚印章，还没写完的：落在哪（归一化）、点中了哪个元素。 */
interface PendingComment {
  x: number;
  y: number;
  element?: VideoAnnotationElement;
}
/** 正在写的文字：新的（没有 id）或改一条已有的。 */
interface TextDraft {
  id?: string;
  x: number;
  y: number;
  text: string;
}
/** 画笔与形状的进行中手势（像素，相对画面）。 */
interface Draft {
  kind: Mark['kind'];
  from: Point;
  to: Point;
  points: Point[];
}

/**
 * 标记层（lite-editor §4.1）：标注模式里挂（preview.tsx，两种视图都是）。`frame` 是画面在舞台里的位置（像素），
 * `segments` 是轻量视图的分段（时间线视图给空表，标注就只有时刻）；
 * `canvasRef` 是预览画布（评论截图从这里拷一份）。连同工具条与「放弃这些标记？」一起渲染。
 * `pickLive` 问实时合成层（HTML 动画视频的 iframe）里某一点（画布像素）下最内层的节点：同步命中的是实时合成层那件时才问，
 * 问到了用它，问不到退回那个元素命中（lite-editor §11 第 12 条）。
 */
export function LiteMarkupLayer({
  videoId,
  sequence,
  assets,
  documents,
  segments,
  frame,
  canvasRef,
  pickLive,
}: {
  videoId: Id;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
  segments: readonly LiteSegment[];
  frame: FrameRect;
  canvasRef: { current: HTMLCanvasElement | null };
  pickLive: (point: Point) => Promise<MarkupPick | null>;
}) {
  const { engine } = useEditorActions();
  const cache = useRuntime().videos.documents;
  const bind = useLiteMarkup((s) => s.bind);
  const bound = useLiteMarkup((s) => s.videoId === videoId);
  const markup = useLiteMarkup((s) => s.markup);
  const apply = useLiteMarkup((s) => s.apply);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hover, setHover] = useState<MarkupPick | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [comment, setComment] = useState<PendingComment | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const local = useRef({ textDraft, comment });
  local.current = { textDraft, comment };
  /** 拾取的序号：悬停、离开、按下都加一，异步回来的只认最新的那次（iframe 的回信可能晚于指针）。 */
  const pickSeq = useRef(0);
  /** 最近一次悬停拾取落在哪（像素，相对画面）、拾到了什么：按下的点与它相同就直接用，不再问一遍 iframe。 */
  const hoverAt = useRef<{ seq: number; at: Point; pick: MarkupPick | null } | null>(null);
  const alive = useRef(true);
  const C = LITE_MARKUP_COPY;
  const nowMs = useEditor((s) => Math.round(s.playhead * 1000));

  useEffect(() => bind(videoId), [bind, videoId]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pickSeq.current += 1;
    };
  }, []);

  // 标记的键（lite-editor §4.1「键盘」）：在窗口的捕获阶段先接，接了就不往下传——⌘Z 撤的是标记，不是视频；Esc 先关文字与评论框，
  // 再关标注模式（有没发的标记时先问）。焦点在输入框里、或开着对话框与菜单时不接，留给它们自己。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      const mod = MAC ? event.metaKey : event.ctrlKey;
      const letter = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
      const stop = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      const store = useLiteMarkup.getState();
      if (mod && event.shiftKey && !event.altKey && (letter === 's' || letter === 'c')) {
        stop();
        store.apply((s) => setTool(s, letter === 's' ? 'element' : 'comment'));
        return;
      }
      if (mod && !event.altKey && (letter === 'z' || (!MAC && letter === 'y'))) {
        stop();
        store.apply(event.shiftKey || letter === 'y' ? redo : undo);
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !mod && store.markup.sel) {
        const sel = store.markup.sel;
        const mark = store.markup.marks.find((m) => m.id === sel);
        // 选中的那条不在当前帧上（播放头挪走了）：看不见的不删。
        if (!mark || !onFrame(mark, frameMs())) return;
        stop();
        store.apply((s) => remove(s, sel));
        return;
      }
      if (event.key === 'Escape' && !mod) {
        stop();
        if (local.current.textDraft || local.current.comment) {
          setTextDraft(null);
          setComment(null);
          return;
        }
        store.close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!bound) return null;
  const fw = frame.width;
  const fh = frame.height;
  const size = { w: fw, h: fh };
  const canvas = sequence.canvas;
  const tool = markup.tool;
  const picking = tool === 'element' || tool === 'comment';

  const at = (event: { clientX: number; clientY: number }): Point => {
    const box = layerRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const cueText = (hit: CaptionHit): string | undefined => {
    const record = documents[hit.documentId];
    if (!record) return undefined;
    return readCaptions(cache.peek(hit.documentId, record.currentRevision))?.cues.find((cue) => cue.id === hit.cueId)?.text;
  };
  const toCanvas = (p: Point): Point => ({ x: (p.x / fw) * canvas.width, y: (p.y / fh) * canvas.height });
  /** 画面上这一点（像素，相对画面）点中了什么（同步的一半：字幕行与画面上的实例）。 */
  const pickAt = (p: Point): MarkupPick | null =>
    fw > 0 && fh > 0
      ? pickElement({
          point: toCanvas(p),
          canvas,
          captionHits: engine.captionHits,
          layers: stageLayers(engine.plan),
          sequence,
          poseOf: (item: SequenceItem) => (isPlaced(item) ? stagePose(item, canvas, assets) : null),
          cueText,
        })
      : null;
  /**
   * 连同实时合成层里的节点：同步命中的是实时合成层那件（与 `stageLayers` 看的是同一份帧计划）时再问 iframe，问到了用它，否则退回元素命中。
   * 不在实时合成层上时同步给出（`sync`），不用等。
   */
  const resolvePick = (p: Point): { sync: MarkupPick | null } | { live: Promise<MarkupPick | null> } => {
    const hit = pickAt(p);
    if (!wantsLivePick(hit, engine.plan?.live?.itemId)) return { sync: hit };
    return {
      live: pickLive(toCanvas(p)).then(
        (node) => node ?? hit,
        () => hit,
      ),
    };
  };

  // ---- 手势 ----

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const from = at(event);
    const norm = { x: from.x / fw, y: from.y / fh };
    apply((s) => select(s, null));
    if (textDraft) {
      commitText();
      return;
    }
    if (tool === 'element') {
      const addPick = (pick: MarkupPick | null) => {
        if (!pick) return;
        const box = normalizedRect(pick.rect, canvas);
        place({ kind: 'element', ...box, element: pick.element, elementBox: box });
        setHover(null);
      };
      // 悬停已经在这一点上拾过（且没有更新的一次在路上）：直接用；否则再拾一次，等完核对层还挂着、工具没换、指针没再动。
      const last = hoverAt.current;
      const seq = ++pickSeq.current;
      hoverAt.current = null;
      if (last && last.seq === seq - 1 && Math.hypot(last.at.x - from.x, last.at.y - from.y) < 1) {
        addPick(last.pick);
        return;
      }
      const picked = resolvePick(from);
      if ('sync' in picked) {
        addPick(picked.sync);
        return;
      }
      void picked.live.then((pick) => {
        if (!alive.current || seq !== pickSeq.current || useLiteMarkup.getState().markup.tool !== 'element') return;
        pickSeq.current += 1;
        addPick(pick);
      });
      return;
    }
    if (tool === 'comment') {
      pickSeq.current += 1;
      hoverAt.current = null;
      setComment({ ...norm, ...(hover?.element ? { element: hover.element } : {}) });
      setHover(null);
      return;
    }
    if (tool === 'text') {
      setTextDraft({ ...norm, text: '' });
      return;
    }
    const kind = tool === 'pen' ? 'pen' : markup.shape;
    let gesture: Draft = { kind, from, to: from, points: [from] };
    setDraft(gesture);
    const onMove = (ev: PointerEvent) => {
      const to = at(ev);
      gesture = { ...gesture, to, points: kind === 'pen' ? [...gesture.points, to] : gesture.points };
      setDraft(gesture);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDraft(null);
      if (ev.type === 'pointercancel') return;
      const to = at(ev);
      const moved = Math.hypot(to.x - from.x, to.y - from.y) >= MOVE_MIN;
      if (kind === 'pin') place({ kind, ...fromGesture(kind, from, null, size) });
      else if (moved) {
        const points = kind === 'pen' ? [...gesture.points, to] : undefined;
        place({ kind, ...fromGesture(kind, from, to, size, points) });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  /** 悬停：最新的一次为准（实时合成层的节点要等 iframe 回信，回来时指针已经又动过的就不用了）。 */
  const hoverMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!picking || draft || event.target !== event.currentTarget) return;
    const p = at(event);
    const seq = ++pickSeq.current;
    const show = (pick: MarkupPick | null) => {
      hoverAt.current = { seq, at: p, pick };
      setHover((h) => (same(h, pick) ? h : pick));
    };
    const picked = resolvePick(p);
    if ('sync' in picked) {
      show(picked.sync);
      return;
    }
    void picked.live.then((pick) => {
      if (alive.current && seq === pickSeq.current) show(pick);
    });
  };
  const hoverLeave = () => {
    pickSeq.current += 1;
    hoverAt.current = null;
    setHover(null);
  };

  /** 按下一条已有的标记：选中它，拖动就挪（或拖把手改形）；松手记一次历史。 */
  const grab = (event: ReactPointerEvent, mark: Mark, which?: MarkupHandle) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (textDraft) commitText();
    apply((s) => select(s, mark.id));
    const from = at(event);
    const onMove = (ev: PointerEvent) => {
      const p = at(ev);
      const dx = (p.x - from.x) / fw;
      const dy = (p.y - from.y) / fh;
      const next = which ? resize(mark, which, dx, dy) : move(mark, dx, dy);
      apply((s) => update(s, mark.id, next, { history: false }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      apply((s) => finishDrag(s, mark.id, mark));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // ---- 文字 ----

  function commitText() {
    const d = local.current.textDraft;
    setTextDraft(null);
    if (!d) return;
    const text = d.text.trim();
    if (d.id) {
      const id = d.id;
      apply((s) => (text ? update(s, id, { text }) : remove(s, id)));
    } else if (text) place({ kind: 'text', x: d.x, y: d.y, w: 0, h: 0, text });
  }

  // ---- 发出去 ----

  /** 画一条：记下此刻的播放头（这条标记属于这一帧），第一次在这一帧上画时把画布拷一份留着当截图。 */
  const place = (input: Omit<MarkInput, 'timeMs'>) => {
    const timeMs = frameMs();
    apply((s) => add(s, { ...input, timeMs }));
    void keepFrame(timeMs, canvasRef.current);
  };
  /** 一组标记换成视频标注：每条按自己的时刻带落点（播放头所在的段与句）、这个版本。视频不是这一部（还没打开好）时 null。 */
  const buildNotes = (marks: readonly Mark[]): DraftVideoAnnotation[] | null => {
    const open = useVideo.getState().video;
    const revision = open?.state?.video.revision;
    if (!open || open.videoId !== videoId || revision === undefined) return null;
    return toNotes(marks, { videoId, video: open.target, revision, segments });
  };
  /** 逐条进草稿，碰到第一条加不进去的就停：已经加进去的从画面与历史里拿掉，报原因。返回加进去的条数，失败时 null。 */
  const addNotes = (notes: readonly DraftVideoAnnotation[]): number | null => {
    const store = useDraftVideoAnnotations.getState();
    const added: string[] = [];
    for (const note of notes) {
      const error = store.add(videoId, note);
      if (error) {
        if (added.length) apply((s) => forget(s, added));
        ToastQueue.negative(videoAnnotationErrorText(error), { timeout: 5000 });
        return null;
      }
      added.push(note.id);
    }
    return added.length;
  };
  const addToChat = () => {
    const marks = useLiteMarkup.getState().markup.marks;
    const notes = buildNotes(marks);
    if (!notes?.length) return;
    const n = addNotes(notes);
    if (n === null) return;
    const sent = new Set(notes.map((note) => note.id));
    // 截图先拷走再清空：`discard` 把留着的帧一起清了。
    void attachFrames(
      marks.filter((m) => sent.has(m.id)),
      canvasRef.current,
      size,
      C.me,
    );
    ToastQueue.neutral(C.added(n), { timeout: 3000 });
    useLiteMarkup.getState().discard();
  };
  const sendComment = (text: string, toAgent: boolean) => {
    const pending = comment;
    if (!pending || !text.trim()) return;
    const input: Omit<MarkInput, 'timeMs'> = {
      kind: 'comment',
      x: pending.x,
      y: pending.y,
      w: 0,
      h: 0,
      text: text.trim(),
      ...(pending.element ? { element: pending.element } : {}),
    };
    if (!toAgent) {
      place(input);
      setComment(null);
      ToastQueue.neutral(C.kept, { timeout: 3000 });
      return;
    }
    const mark: Mark = { ...input, id: newId('mk'), timeMs: frameMs(), color: markup.color, width: markup.width };
    const notes = buildNotes([mark]);
    if (!notes?.length) return;
    if (addNotes(notes) === null) return;
    void attachFrames([mark], canvasRef.current, size, C.me);
    setComment(null);
    ToastQueue.neutral(C.added(1), { timeout: 3000 });
  };

  // ---- 画 ----

  const ghost = draft
    ? (() => {
        const kind = draft.kind;
        const moved = Math.hypot(draft.to.x - draft.from.x, draft.to.y - draft.from.y) >= MOVE_MIN;
        if (kind === 'pin' || !moved) return null;
        const geo = fromGesture(kind, draft.from, draft.to, size, kind === 'pen' ? draft.points : undefined);
        return { id: 'ghost', kind, color: markup.color, width: markup.width, ...geo } as Mark;
      })()
    : null;
  // 只画这一帧的（±near 毫秒，同草稿里的标注）；选中的那条不在这一帧上就不画把手。
  const shown = markup.marks.filter((m) => onFrame(m, nowMs));
  const selected = shown.find((m) => m.id === markup.sel) ?? null;
  const svgMarks = shown.filter((m) => SVG_KINDS.has(m.kind));
  const htmlMarks = shown.filter((m) => !SVG_KINDS.has(m.kind));

  return (
    <>
      <div
        ref={layerRef}
        className={surface({ isPoint: tool === 'text' || (tool === 'shape' && markup.shape === 'pin'), isPick: picking })}
        style={frame}
        data-lite-markup
        onPointerDown={down}
        onPointerMove={hoverMove}
        onPointerLeave={hoverLeave}
        onClick={(event) => event.stopPropagation()}
      >
        <svg className={drawing} width={fw} height={fh} aria-hidden>
          {svgMarks.map((m) => (
            <SvgMark key={m.id} mark={m} frame={size} onGrab={(event) => grab(event, m)} />
          ))}
          {ghost ? <SvgMark mark={ghost} frame={size} /> : null}
        </svg>
        {htmlMarks.map((m) =>
          m.kind === 'pin' ? (
            <span
              key={m.id}
              className={pinMark({ tone: m.color })}
              style={{ left: pct(m.x), top: pct(m.y) }}
              data-mark={m.kind}
              onPointerDown={(event) => grab(event, m)}
            >
              {stepNumber(markup.marks, m.id)}
            </span>
          ) : m.kind === 'comment' ? (
            <span
              key={m.id}
              className={stampMark({ tone: m.color })}
              style={{ left: pct(m.x), top: pct(m.y) }}
              role="img"
              aria-label={C.stamp(m.text ?? '')}
              data-mark={m.kind}
              onPointerDown={(event) => grab(event, m)}
            >
              {C.me}
            </span>
          ) : textDraft?.id === m.id ? null : (
            <span
              key={m.id}
              className={textMark({ tone: m.color })}
              style={{ left: pct(m.x), top: pct(m.y), fontSize: MARKUP_TEXT_SIZE[m.width] }}
              data-mark={m.kind}
              onPointerDown={(event) => grab(event, m)}
              onDoubleClick={() => setTextDraft({ id: m.id, x: m.x, y: m.y, text: m.text ?? '' })}
            >
              {m.text}
            </span>
          ),
        )}
        {selected ? <Selection mark={selected} frame={size} onGrab={(event, k) => grab(event, selected, k)} /> : null}
        {textDraft ? (
          <input
            className={textInput({ tone: markup.color })}
            style={{ left: pct(textDraft.x), top: pct(textDraft.y), fontSize: MARKUP_TEXT_SIZE[markup.width] }}
            aria-label={C.textMark}
            placeholder={C.textPlaceholder}
            value={textDraft.text}
            autoFocus
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const text = event.target.value;
              setTextDraft((d) => (d ? { ...d, text } : d));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitText();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setTextDraft(null);
              }
            }}
            onBlur={() => commitText()}
          />
        ) : null}
        {hover && picking ? <PickHint pick={hover} canvas={canvas} brief={tool === 'comment'} /> : null}
        <CommentBox pending={comment} color={markup.color} onSend={sendComment} onCancel={() => setComment(null)} />
      </div>
      <LiteMarkupBar frame={frame} onAddToChat={addToChat} />
      <DialogContainer onDismiss={() => apply((s) => ({ ...s, ask: false }))}>
        {markup.ask ? (
          <AlertDialog
            variant="destructive"
            title={C.discardTitle}
            primaryActionLabel={C.discard}
            cancelLabel={C.keepMarking}
            onPrimaryAction={() => useLiteMarkup.getState().discard()}
            onCancel={() => apply((s) => ({ ...s, ask: false }))}
          >
            {C.discardBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </>
  );
}

const SVG_KINDS = new Set<Mark['kind']>(['pen', 'line', 'arrow', 'box', 'ellipse', 'element']);
const same = (a: MarkupPick | null, b: MarkupPick | null) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

/** 一条线、框、圆、画笔或元素框：像素坐标画在画面大小的 SVG 里；`onGrab` 接在一条透明的宽描边上（框与圆只有边能点中）。 */
function SvgMark({ mark: m, frame, onGrab }: { mark: Mark; frame: { w: number; h: number }; onGrab?: (event: ReactPointerEvent) => void }) {
  const X = (v: number) => v * frame.w;
  const Y = (v: number) => v * frame.h;
  const sw = m.width;
  const hit = Math.max(HIT_MIN, sw + 8);
  const grabProps = onGrab ? { className: hitStroke, pointerEvents: 'stroke' as const, onPointerDown: onGrab } : null;
  let shape: ReactElement | null = null;
  let hitShape: ReactElement | null = null;
  if (m.kind === 'pen' && m.points?.length) {
    const points = m.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
    shape = <polyline points={points} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />;
    hitShape = grabProps ? <polyline points={points} fill="none" stroke="transparent" strokeWidth={hit} {...grabProps} /> : null;
  } else if ((m.kind === 'line' || m.kind === 'arrow') && m.to) {
    const x1 = X(m.x);
    const y1 = Y(m.y);
    const x2 = X(m.to.x);
    const y2 = Y(m.to.y);
    const headSize = sw * 3 + 6;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const tip = (a: number) => `${x2 - headSize * Math.cos(angle - a)},${y2 - headSize * Math.sin(angle - a)}`;
    shape = (
      <>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
        {m.kind === 'arrow' ? (
          <polygon
            points={`${x2},${y2} ${tip(0.45)} ${tip(-0.45)}`}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={1}
            strokeLinejoin="round"
          />
        ) : null}
      </>
    );
    hitShape = grabProps ? <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={hit} {...grabProps} /> : null;
  } else if (m.kind === 'ellipse') {
    const props = { cx: X(m.x + m.w / 2), cy: Y(m.y + m.h / 2), rx: X(m.w) / 2, ry: Y(m.h) / 2 };
    shape = <ellipse {...props} fill="none" stroke="currentColor" strokeWidth={sw} />;
    hitShape = grabProps ? <ellipse {...props} fill="none" stroke="transparent" strokeWidth={hit} {...grabProps} /> : null;
  } else {
    const props = { x: X(m.x), y: Y(m.y), width: X(m.w), height: Y(m.h) };
    shape = <rect {...props} rx={m.kind === 'element' ? 4 : 2} fill="none" stroke="currentColor" strokeWidth={sw} />;
    hitShape = grabProps ? <rect {...props} fill="none" stroke="transparent" strokeWidth={hit} {...grabProps} /> : null;
  }
  return (
    <g className={ink({ tone: m.color })} data-mark={m.kind}>
      {shape}
      {hitShape}
    </g>
  );
}

/** 选中的标记：虚线外接框与把手（矩形、圆、元素八枚，直线 / 箭头两端）。 */
function Selection({
  mark,
  frame,
  onGrab,
}: {
  mark: Mark;
  frame: { w: number; h: number };
  onGrab: (event: ReactPointerEvent, k: MarkupHandle) => void;
}) {
  const point = mark.w === 0 && mark.h === 0 && !mark.to && !mark.points;
  const b = mark.to ? lineBox(mark) : { x: mark.x, y: mark.y, w: mark.w, h: mark.h };
  return (
    <>
      {point ? null : (
        <div
          className={selection}
          style={{ left: b.x * frame.w - 4, top: b.y * frame.h - 4, width: b.w * frame.w + 8, height: b.h * frame.h + 8 }}
          data-selection
        />
      )}
      {handles(mark).map((h) => (
        <span
          key={h.k}
          className={handle}
          style={{ left: pct(h.x), top: pct(h.y), cursor: CURSORS[h.k] }}
          data-handle={h.k}
          onPointerDown={(event) => onGrab(event, h.k)}
        />
      ))}
    </>
  );
}
const lineBox = (m: Mark): Rect => {
  const x0 = Math.min(m.x, m.to!.x);
  const y0 = Math.min(m.y, m.to!.y);
  return { x: x0, y: y0, w: Math.abs(m.to!.x - m.x), h: Math.abs(m.to!.y - m.y) };
};
const CURSORS: Record<MarkupHandle, CSSProperties['cursor']> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  from: 'move',
  to: 'move',
};

/**
 * 选择元素的悬停：高亮框与说明卡（元素是什么、画布上多大）。卡在框下面，靠底时翻到上面。HTML 动画里的节点照 DevTools 的检查提示：
 * 第一行选择器与节点的 CSS 像素尺寸，下面可访问性的名称 / 角色 / 键盘可聚焦（空的是「—」）；评论工具（`brief`）只要第一行。
 */
function PickHint({ pick, canvas, brief }: { pick: MarkupPick; canvas: { width: number; height: number }; brief?: boolean }) {
  const r = normalizedRect(pick.rect, canvas);
  const below = r.y + r.h < 0.8;
  const C = LITE_MARKUP_COPY.pickInfo;
  const el = pick.element;
  const html = el.kind === 'html' ? el : null;
  const size = html ? { w: html.w ?? pick.rect.w, h: html.h ?? pick.rect.h } : pick.rect;
  return (
    <>
      <div className={pickBox} style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }} data-pick-box />
      <div
        className={pickCard}
        style={below ? { left: pct(r.x), top: `calc(${pct(r.y + r.h)} + 6px)` } : { left: pct(r.x), bottom: `calc(${pct(1 - r.y)} + 6px)` }}
        data-pick-card
      >
        <span className={html ? pickHead : pickLabel}>
          <span className={pickLabel}>{html ? html.selector : videoAnnotationElementLabel(el)}</span>
          {html ? (
            <span className={pickSize}>
              {Math.round(size.w)} × {Math.round(size.h)}
            </span>
          ) : null}
        </span>
        {html ? null : (
          <span className={pickSize}>
            {Math.round(size.w)} × {Math.round(size.h)}
          </span>
        )}
        {html && !brief ? (
          <>
            <span className={pickHeading}>{C.heading}</span>
            <PickRow label={C.name} value={html.name || '—'} />
            <PickRow label={C.role} value={html.role || '—'} />
            <PickRow label={C.focusable} value={html.focusable ? '✓' : '—'} />
          </>
        ) : null}
      </div>
    </>
  );
}

function PickRow({ label, value }: { label: string; value: string }) {
  return (
    <span className={pickRow}>
      <span className={pickSize}>{label}</span>
      <span className={pickLabel}>{value}</span>
    </span>
  );
}

/** 评论：先落一枚印章，弹出批注框——写一句、勾不勾「发给智能体」、发送或取消。空的发不出去。 */
function CommentBox({
  pending,
  color,
  onSend,
  onCancel,
}: {
  pending: PendingComment | null;
  color: VideoAnnotationColor;
  onSend: (text: string, toAgent: boolean) => void;
  onCancel: () => void;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState('');
  const [toAgent, setToAgent] = useState(true);
  const C = LITE_MARKUP_COPY;
  useEffect(() => {
    if (pending) setText('');
  }, [pending]);
  return (
    <>
      {pending ? (
        <span className={stampMark({ tone: color })} style={{ left: pct(pending.x), top: pct(pending.y) }} aria-hidden data-pending-comment>
          {C.me}
        </span>
      ) : null}
      <span ref={anchorRef} className={anchorDot} style={{ left: pct(pending?.x ?? 0), top: pct(pending?.y ?? 0) }} />
      <Popover
        triggerRef={anchorRef}
        isOpen={!!pending}
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
        placement="bottom start"
        padding="default"
        aria-label={C.comment}
      >
        <div className={commentForm} data-comment-form>
          <TextArea
            aria-label={C.comment}
            size="S"
            placeholder={C.commentPlaceholder}
            value={text}
            onChange={setText}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (MAC ? event.metaKey : event.ctrlKey)) {
                event.preventDefault();
                onSend(text, toAgent);
              }
            }}
          />
          <Checkbox size="S" isSelected={toAgent} onChange={setToAgent}>
            {C.sendToAgent}
          </Checkbox>
          <div className={commentActions}>
            <Button size="S" variant="secondary" fillStyle="outline" onPress={onCancel}>
              {C.cancel}
            </Button>
            <Button size="S" variant="accent" isDisabled={!text.trim()} onPress={() => onSend(text, toAgent)}>
              {C.send}
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}

/**
 * 标记工具条（lite-editor §4.1；照截图标注器，一行）：选择元素 / 评论 / 画笔 / 形状▾ ｜ 文字 ｜ 颜色▾ ｜ 粗细▾ ｜ 添加到对话 / 关闭。
 * 撤销 / 重做 / 删选中的不占钮，走 ⌘Z / ⇧⌘Z / Delete（标记层的键）。浮在画面底边上方；`frame` 是画面在舞台里的位置。
 */
export function LiteMarkupBar({ frame, onAddToChat }: { frame: FrameRect; onAddToChat: () => void }) {
  const markup = useLiteMarkup((s) => s.markup);
  const apply = useLiteMarkup((s) => s.apply);
  const C = LITE_MARKUP_COPY;
  const keys = (label: string, k?: string) => (k ? C.withKeys(label, keyLabel(k, MAC)) : label);
  const toolButton = (tool: MarkupTool, icon: ReactElement) => (
    <Tip key={tool} label={keys(C.tools[tool], KEYS[tool])}>
      <RACToggleButton
        className={({ isSelected, isHovered, isPressed, isFocusVisible }) => toolBtn({ isSelected, isHovered, isPressed, isFocusVisible })}
        aria-label={C.tools[tool]}
        isSelected={markup.tool === tool}
        onChange={() => apply((s) => setTool(s, tool))}
      >
        {icon}
      </RACToggleButton>
    </Tip>
  );
  /** 带下拉的钮：图标显示当前值，右边一枚小箭头；是 MenuTrigger 的触发钮。 */
  const menuButton = (label: string, isSelected: boolean, content: ReactElement) => (
    <Tip label={label}>
      <RACButton
        className={({ isHovered, isPressed, isFocusVisible }) =>
          toolBtn({ isSelected, isHovered, isPressed, isFocusVisible, hasMenu: true })
        }
        aria-label={label}
      >
        {content}
        <span className={chevronWrap} aria-hidden>
          <ChevronDown styles={chevron} />
        </span>
      </RACButton>
    </Tip>
  );
  const Shape = SHAPE_GLYPHS[markup.shape];
  const count = sendable(markup.marks).length;
  return (
    <div
      className={bar}
      style={{ left: frame.left + frame.width / 2, top: frame.top + frame.height - 12 }}
      role="toolbar"
      aria-label={C.toolbar}
      data-lite-markup-bar
      onPointerDown={(event) => event.stopPropagation()}
    >
      {toolButton('element', <Select styles={toolIcon} />)}
      {toolButton('comment', <Comment styles={toolIcon} />)}
      {toolButton('pen', <Brush styles={toolIcon} />)}
      <MenuTrigger
        onOpenChange={(open) => {
          if (open) apply((s) => setTool(s, 'shape'));
        }}
      >
        {menuButton(C.current(C.tools.shape, C.shapes[markup.shape]), markup.tool === 'shape', <Shape styles={toolIcon} />)}
        <Menu
          aria-label={C.shapeMenu}
          selectionMode="single"
          selectedKeys={[markup.shape]}
          onAction={(key) => apply((s) => setShape(s, key as MarkupShape))}
        >
          {MARKUP_SHAPES.map((shape) => {
            const Glyph = SHAPE_GLYPHS[shape];
            return (
              <MenuItem key={shape} id={shape} textValue={C.shapes[shape]}>
                <Glyph />
                <Text slot="label">{C.shapes[shape]}</Text>
              </MenuItem>
            );
          })}
        </Menu>
      </MenuTrigger>
      <span className={divider} />
      {toolButton('text', <TextIcon styles={toolIcon} />)}
      <span className={divider} />
      <MenuTrigger>
        {menuButton(C.current(C.color, C.colors[markup.color]), false, <span className={swatchDot({ tone: markup.color })} />)}
        <Menu
          aria-label={C.color}
          selectionMode="single"
          selectedKeys={[markup.color]}
          onAction={(key) => apply((s) => setColor(s, key as VideoAnnotationColor))}
        >
          {MARKUP_COLORS.map((color) => (
            <MenuItem key={color} id={color} textValue={C.colors[color]}>
              <Text slot="label">
                <span className={menuRow}>
                  <span className={swatchDot({ tone: color })} />
                  {C.colors[color]}
                </span>
              </Text>
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
      <span className={divider} />
      <MenuTrigger>
        {menuButton(C.current(C.width, C.widthValue(markup.width)), false, <WidthLine width={markup.width} />)}
        <Menu
          aria-label={C.width}
          selectionMode="single"
          selectedKeys={[markup.width]}
          onAction={(key) => apply((s) => setWidth(s, Number(key) as VideoAnnotationWidth))}
        >
          {MARKUP_WIDTHS.map((width) => (
            <MenuItem key={width} id={width} textValue={C.widthValue(width)}>
              <Text slot="label">
                <span className={menuRow}>
                  <WidthLine width={width} long />
                </span>
              </Text>
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
      <span className={divider} />
      <Button size="S" variant="primary" isDisabled={!count} onPress={onAddToChat}>
        {C.addToChat}
      </Button>
      <Tip label={C.close}>
        <ActionButton size="S" isQuiet aria-label={C.close} onPress={() => useLiteMarkup.getState().close()}>
          <Close />
        </ActionButton>
      </Tip>
    </div>
  );
}

/** 粗细的示意：一段这么粗的横线，圆头缩在框里（最粗的是一枚短胶囊）；下拉里的 `long` 更长一些。 */
function WidthLine({ width, long = false }: { width: VideoAnnotationWidth; long?: boolean }) {
  const w = long ? 32 : 20;
  return (
    <svg width={w} height={16} viewBox={`0 0 ${w} 16`} aria-hidden>
      <line x1={2 + width / 2} y1={8} x2={w - 2 - width / 2} y2={8} stroke="currentColor" strokeWidth={width} strokeLinecap="round" />
    </svg>
  );
}

// ---- 帧截图 ----

/** 此刻的播放头，毫秒整数（标记属于这一帧）。 */
function frameMs(): number {
  return Math.round(useEditor.getState().playhead * 1000);
}
/** 这条标记在这一帧上吗：时刻相差不超过 `VIDEO_ANNOTATION_NEAR_MS`（同草稿里的标注）。 */
function onFrame(mark: Mark, nowMs: number): boolean {
  return Math.abs(mark.timeMs - nowMs) <= VIDEO_ANNOTATION_NEAR_MS;
}

/**
 * 画下第一条标记的那一刻把预览画布拷成 PNG 留在 store 里（同一帧只留第一次；出不了图就不留，「添加到对话」时再提示）。
 * 画布拷贝是同步的，PNG 编码在后面慢慢做；此刻的定位若还在路上，截到的是画布上实际那一帧。
 */
async function keepFrame(timeMs: number, source: HTMLCanvasElement | null): Promise<void> {
  const store = useLiteMarkup.getState();
  if (!source || store.frames[timeMs]) return;
  const png = await snapshot(source).catch(() => null);
  if (png) useLiteMarkup.getState().keepFrame(timeMs, png);
}
/** 画布此刻的像素拷成 PNG（先同步拷到另一张画布，再异步编码）。 */
function snapshot(source: HTMLCanvasElement): Promise<Blob | null> {
  const w = source.width;
  const h = source.height;
  if (!w || !h) return Promise.resolve(null);
  const copy = document.createElement('canvas');
  copy.width = w;
  copy.height = h;
  const ctx = copy.getContext('2d');
  let out: HTMLCanvasElement = source;
  if (ctx) {
    ctx.drawImage(source, 0, 0);
    out = copy;
  }
  if (typeof out.toBlob !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}

/**
 * 截图（lite-editor §4.1）：这组标记涉及的每一帧出一张图，底是画那条标记时留下的那一帧（没留下就用此刻的画布，播放头若还在那一帧上
 * 就是对的），上面画这一帧的标记（线条按画布与画面的比例放大，评论画印章，尖角落在点上），存成 PNG 放进开着的视频旁边那个
 * 输入框的草稿图片。哪一帧出不了图就提示一次，标注照样已经加了。预览里 HTML 动画的实时合成层（iframe）不在画布上，截不进来。
 */
async function attachFrames(marks: readonly Mark[], source: HTMLCanvasElement | null, layer: Size, initials: string): Promise<void> {
  const frames = useLiteMarkup.getState().frames;
  const files: File[] = [];
  let failed = false;
  for (const timeMs of markFrames(marks)) {
    const onThis = marks.filter((m) => m.timeMs === timeMs);
    const file = await paintFrame(frames[timeMs] ?? source, onThis, marks, timeMs, layer, initials).catch(() => null);
    if (file) files.push(file);
    else failed = true;
  }
  if (failed) ToastQueue.neutral(LITE_MARKUP_COPY.shotFailed, { timeout: 4000 });
  if (files.length)
    useDraftImages.getState().add(
      openVideoDraftKey(useShell.getState().route),
      files.map((file) => imageEntry(file)),
    );
}

/** 一帧的图：底图（留下的 PNG 或画布）画到新画布上，再把这一帧的标记画上去（序号按整组 `group` 数），存成 `frame-<毫秒>.png`。 */
export async function paintFrame(
  base: Blob | HTMLCanvasElement | null | undefined,
  marks: readonly Mark[],
  group: readonly Mark[],
  timeMs: number,
  layer: Size,
  initials: string,
): Promise<File | null> {
  if (!base) return null;
  const image = base instanceof Blob ? await loadImage(base) : base;
  const w = image.width;
  const h = image.height;
  if (!w || !h) return null;
  const copy = document.createElement('canvas');
  copy.width = w;
  copy.height = h;
  const ctx = copy.getContext('2d');
  let out: HTMLCanvasElement = base instanceof Blob ? copy : base;
  if (ctx) {
    ctx.drawImage(image, 0, 0);
    paintMarks(ctx, marks, { w, h }, layer, initials, group);
    out = copy;
  }
  if (typeof out.toBlob !== 'function') return null;
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new File([blob], `frame-${timeMs}.png`, { type: 'image/png' });
}
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('frame image failed to decode'));
    };
    image.src = url;
  });
}

/**
 * 把一帧的标记画到画布上（同 SvgMark 与 HTML 标记的样子）：坐标按归一化值落到画布像素，线宽、字号与印章按画布比画面的比例放大，
 * 文字描一圈反色边代替网页里的阴影；序号按 `group`（整组标记，默认就是这些）数。
 */
export function paintMarks(
  ctx: CanvasRenderingContext2D,
  marks: readonly Mark[],
  size: Size,
  layer: Size,
  initials: string,
  group: readonly Mark[] = marks,
): void {
  const X = (v: number) => v * size.w;
  const Y = (v: number) => v * size.h;
  const scale = layer.w > 0 ? size.w / layer.w : 1;
  for (const m of marks) {
    const fill = SHOT_COLORS[m.color];
    const sw = m.width * scale;
    ctx.save();
    ctx.strokeStyle = fill;
    ctx.fillStyle = fill;
    ctx.lineWidth = sw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (m.kind === 'pen' && m.points?.length) {
      ctx.beginPath();
      m.points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.stroke();
    } else if ((m.kind === 'line' || m.kind === 'arrow') && m.to) {
      const x1 = X(m.x);
      const y1 = Y(m.y);
      const x2 = X(m.to.x);
      const y2 = Y(m.to.y);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (m.kind === 'arrow') {
        const headSize = sw * 3 + 6 * scale;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headSize * Math.cos(angle - 0.45), y2 - headSize * Math.sin(angle - 0.45));
        ctx.lineTo(x2 - headSize * Math.cos(angle + 0.45), y2 - headSize * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.lineWidth = scale;
        ctx.fill();
        ctx.stroke();
      }
    } else if (m.kind === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(X(m.x + m.w / 2), Y(m.y + m.h / 2), X(m.w) / 2, Y(m.h) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (m.kind === 'box' || m.kind === 'element') {
      ctx.beginPath();
      ctx.roundRect(X(m.x), Y(m.y), X(m.w), Y(m.h), (m.kind === 'element' ? 4 : 2) * scale);
      ctx.stroke();
    } else if (m.kind === 'pin') {
      const r = 12 * scale;
      const cx = X(m.x);
      const cy = Y(m.y);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = fill === SHOT_COLORS.white ? '#000000' : '#ffffff';
      ctx.lineWidth = 2 * scale;
      ctx.stroke();
      ctx.fillStyle = fill === SHOT_COLORS.white ? '#000000' : '#ffffff';
      ctx.font = `bold ${Math.round(12 * scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(stepNumber(group, m.id) ?? ''), cx, cy);
    } else if (m.kind === 'comment') {
      drawStamp(ctx, X(m.x), Y(m.y), Math.max(14, Math.round(Math.min(size.w, size.h) / 40)), fill, initials);
    } else if (m.kind === 'text' && m.text) {
      const px = MARKUP_TEXT_SIZE[m.width] * scale;
      ctx.font = `bold ${Math.round(px)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.strokeStyle = fill === SHOT_COLORS.white ? 'rgb(0 0 0 / 0.9)' : 'rgb(255 255 255 / 0.9)';
      ctx.lineWidth = Math.max(2, px / 6);
      m.text.split('\n').forEach((line, i) => {
        const y = Y(m.y) + i * px * 1.2;
        ctx.strokeText(line, X(m.x), y);
        ctx.fillText(line, X(m.x), y);
      });
    }
    ctx.restore();
  }
}

/** 印章：半径 r 的圆，左下角收成尖角落在 (x, y)；白边，写缩写。 */
function drawStamp(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, initials: string): void {
  const cx = x + r;
  const cy = y - r;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, cy);
  ctx.arc(cx, cy, r, Math.PI, Math.PI / 2, false);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill === SHOT_COLORS.white ? '#000000' : '#ffffff';
  ctx.lineWidth = Math.max(2, r / 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = fill === SHOT_COLORS.white ? '#000000' : '#ffffff';
  ctx.font = `bold ${Math.round(r * 0.9)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, cx, cy);
  ctx.restore();
}
