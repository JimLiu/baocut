import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  newId,
  videoAnnotationFrameMs,
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
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import Draw from '@react-spectrum/s2/icons/Draw';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Close from '@react-spectrum/s2/icons/Close';
import Comment from '@react-spectrum/s2/icons/Comment';
import Copy from '@react-spectrum/s2/icons/Copy';
import Download from '@react-spectrum/s2/icons/Download';
import RedoIcon from '@react-spectrum/s2/icons/Redo';
import Select from '@react-spectrum/s2/icons/Select';
import TagBold from '@react-spectrum/s2/icons/TagBold';
import TagItalic from '@react-spectrum/s2/icons/TagItalic';
import TagUnderline from '@react-spectrum/s2/icons/TagUnderline';
import TextIcon from '@react-spectrum/s2/icons/Text';
import TextSize from '@react-spectrum/s2/icons/TextSize';
import UndoIcon from '@react-spectrum/s2/icons/Undo';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { UNSAFE_PortalProvider } from 'react-aria/PortalProvider';
import { Button as RACButton, ToggleButton as RACToggleButton } from 'react-aria-components';
import { formatTenths } from '../../model/format.ts';
import { keyLabel } from '../../model/key-labels.ts';
import type { LiteSegment } from '../../model/lite-segments.ts';
import {
  MARKUP_COLORS,
  MARKUP_FONTS,
  MARKUP_SHAPES,
  MARKUP_TEXT_SIZES,
  markFrames,
  markedFrames,
  MARKUP_WIDTHS,
  add,
  canRedo,
  canUndo,
  currentFrame,
  finishDrag,
  forget,
  fromGesture,
  handles,
  hasWidth,
  isOnFrame,
  marksOnFrame,
  markupMode,
  markupTools,
  move,
  normalizedRect,
  pickElement,
  wantsLivePick,
  redo,
  remove,
  resize,
  screenshotFileName,
  select,
  sendable,
  setColor,
  setShape,
  setTextStyle,
  setTool,
  setWidth,
  stepNumber,
  toNotes,
  undo,
  update,
  type Mark,
  type MarkInput,
  type MarkupHandle,
  type MarkupMode,
  type MarkupPick,
  type MarkupShape,
  type MarkupState,
  type MarkupTextStyle,
  type MarkupTool,
} from '../../model/markup.ts';
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
import { composeLiveFrame, paintFrame, type LiveFrameShot } from '../../render/markup-paint.ts';
import { stageLayers } from '../../render/frame-plan.ts';
import type { CaptionHit } from '../../render/render-planner.ts';
import type { HostBridge } from '../../host.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useDraftVideoAnnotations } from '../../state/draft-video-annotations-store.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useMarkup } from '../../state/markup-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { downloadBlob } from '../media/gif.ts';
import { useEditorActions } from './editor-context.tsx';
import { MARKUP_COPY } from './markup-copy.ts';
import { drawing, pct, pinMark, stampMark, SvgMark, SVG_KINDS, textLook, textMark } from './markup-marks.tsx';

/*
 * 标记层与标记工具条（docs/design/lite-editor §4.1–§4.3；轻量与时间线两种视图同一套）：标注模式（舞台条的「标记」）下盖在画面上，
 * 画笔、形状、文字、选择元素与评论画在这一层；画面底上浮主工具条与副工具条（`MarkupBar`）。标记是这个窗口里的一组（state/markup-store.ts），
 * 每条标记属于画它时的那一帧（播放头）：播放头离开那一帧（±`VIDEO_ANNOTATION_NEAR_MS`）就不画它，回来再画；画下去的那一刻从预览画布
 * 拷一份那一帧留在 store 里。按「添加到对话」整组换成视频标注草稿，每条带自己的时刻、那一刻的段与句，每一帧截一张图（那一帧的画面
 * 加上这一帧的标记）放进输入框；评论勾着「发给智能体」时单独立刻发出，图上画的是印章。已经进草稿的标注照旧由 StageNotesLayer 画
 * （这一层只画还没发的）。
 * Web 没有 BaoCut 会话可发，是截图模式（model/markup.ts 的 `markupMode`，只看宿主平台）：没有评论（选择元素保留），「添加到对话」换成
 * 「复制图片」与「下载图片」——当前帧的画面加上这一帧的标记画成一张 PNG；复制、下载出去后这一帧的标记清掉，关闭时有标记就问一句。
 */

/** 拖动短于这么多像素算「点了一下」。 */
const MOVE_MIN = 4;
const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

type FrameRect = { left: number; top: number; width: number; height: number };

// ---- 样式 ----

/** 标记层铺满画面，接下所有手势（下面的舞台点选层与标注层在标注模式里都不接）。 */
const surface = style({ position: 'absolute', zIndex: 11, cursor: { default: 'crosshair', isPoint: 'cell', isPick: 'default' } });
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
  fontFamily: { default: 'sans', family: { sans: 'sans', serif: 'serif', mono: 'code' } },
  lineHeight: '[1.2]',
  color: { default: 'red-900', tone: { red: 'red-900', blue: 'blue-900', green: 'green-900', black: 'black', white: 'white' } },
  outlineStyle: 'none',
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
/**
 * 主工具条与副工具条叠成一列（原型 `.mk-stack`）：浮在舞台之上（挂在 body 下的 portal、fixed 定位，不受舞台 overflow 裁切），
 * 底边离舞台底 12、主工具条对舞台水平居中，比舞台宽时左右收进窗口 8 以内；两条间隔 2、左端对齐（副工具条不参与居中）。
 */
const stack = style({
  position: 'fixed',
  zIndex: 12,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 2,
});
/** 工具条上的下拉与提示挂在这一层（不占位）：在两条工具条之后，往上弹的菜单压在主工具条之上。 */
const popLayer = style({ position: 'absolute', top: 0, left: 0, width: 0, height: 0 });
/**
 * 一条工具条：一行，按内容定宽、不折行（舞台窄时也不把「添加到对话」挤成几行）。
 * 外观照 S2 ActionBar 的容器：elevated 底、lg 圆角、细边、elevated 阴影。不直接用 ActionBar：它固定带「已选 N 项」与清除钮、
 * 零项时整个隐藏，子节点只收安静的 ActionButton，放不下切换态、分隔线与主按钮。
 */
const bar = style({
  width: 'max',
  whiteSpace: 'nowrap',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  boxSizing: 'border-box',
  padding: 4,
  borderRadius: 'lg',
  borderStyle: 'solid',
  borderWidth: 1,
  borderColor: 'gray-200',
  backgroundColor: 'elevated',
  boxShadow: 'elevated',
});
/** 副工具条上一组钮（一排形状、文字的样式）。 */
const group = style({ display: 'flex', alignItems: 'center', gap: 4 });
/** 下拉钮上的当前值（字号的数字、字体名；字体名用那种字体写）。 */
const barValue = style({
  fontSize: 'ui-sm',
  fontFamily: { default: 'sans', family: { sans: 'sans', serif: 'serif', mono: 'code' } },
});
const divider = style({ width: 1, height: 20, marginX: 4, backgroundColor: 'gray-300', flexShrink: 0 });
/**
 * 工具钮：安静的图标钮，24 方、图标 16、小圆角，底色过渡 60ms 一档；当前工具浅蓝底、蓝图标（照原型的 `.ibtn.is-on`；
 * S2 的切换钮选中是灰底，所以用 RAC 的钮自己画）。带下拉的（形状 / 颜色 / 粗细 / 标记过的帧）随内容加宽、左右各留 4，图标右边紧跟一枚小箭头；
 * 下拉打开时 RAC 把触发钮当按着，显示按下底色；撤销 / 重做无可撤时置灰。
 */
const toolBtn = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  height: 24,
  minWidth: 24,
  boxSizing: 'border-box',
  paddingX: { default: 0, isMenuTrigger: 4 },
  borderRadius: 'sm',
  borderWidth: 0,
  backgroundColor: {
    default: 'transparent',
    isHovered: 'gray-100',
    isPressed: 'gray-200',
    isSelected: { default: 'blue-200', isHovered: 'blue-300' },
  },
  color: { default: 'gray-800', isSelected: 'blue-1000', isDisabled: 'disabled' },
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
/**
 * 带下拉的钮右边的小箭头：12 方（iconStyle 最小的 XS 是 14，图标铺满外面这一层），一直是灰的，选中也不变蓝——外层直接把
 * `--iconPrimary` 定成灰色，不用 currentColor 从钮上继承（钮选中时是蓝的）。
 */
const chevronWrap = style({ display: 'inline-flex', size: 12, flexShrink: 0, '--iconPrimary': { type: 'fill', value: 'gray-600' } });
const chevronFill = { width: '100%', height: '100%' } satisfies CSSProperties;

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
 * `canvasRef` 是预览画布（截图从这里拷一份；这一帧底下是实时合成层时画布透明，改截窗口）。连同工具条与「放弃这些标记？」一起渲染。
 * `pickLive` 问实时合成层（HTML 动画视频的 iframe）里某一点（画布像素）下最内层的节点：同步命中的是实时合成层那件时才问，
 * 问到了用它，问不到退回那个元素命中（lite-editor §11 第 12 条）。
 * `captureLive` 要实时合成层此刻这一帧的图（页面自己画的 PNG 与摆法）：宿主不能截窗口（Web）时截图靠它，没有或画不全时是 null。
 */
export function MarkupLayer({
  videoId,
  sequence,
  assets,
  documents,
  segments,
  frame,
  canvasRef,
  pickLive,
  captureLive,
}: {
  videoId: Id;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
  segments: readonly LiteSegment[];
  frame: FrameRect;
  canvasRef: { current: HTMLCanvasElement | null };
  pickLive: (point: Point) => Promise<MarkupPick | null>;
  captureLive?: () => Promise<LiveFrameShot | null>;
}) {
  const { engine } = useEditorActions();
  const runtime = useRuntime();
  const cache = runtime.videos.documents;
  const capture: CaptureFrame = { window: runtime.host.captureFrame?.bind(runtime.host), live: captureLive, canvas: sequence.canvas };
  /**
   * 截图那一刻画面底下是不是实时合成层（HTML 动画的 iframe）：看引擎这一帧的计划，不看预览状态的 `live`——那个只在替身不可用、
   * 要提醒烘焙时才有，有可用替身的合成照样走实时层、画布照样透明。
   */
  const liveNow = () => !!engine.plan?.live;
  /** 这一组标记的用法：Web 是截图模式（lite-editor §8），别的宿主添加到对话。 */
  const mode = markupMode(runtime.host.platform);
  const bind = useMarkup((s) => s.bind);
  const bound = useMarkup((s) => s.videoId === videoId && s.markup.mode === mode);
  const markup = useMarkup((s) => s.markup);
  const apply = useMarkup((s) => s.apply);
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
  const C = MARKUP_COPY;
  const nowMs = useEditor((s) => Math.round(s.playhead * 1000));

  useEffect(() => bind(videoId, mode), [bind, videoId, mode]);
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
      const store = useMarkup.getState();
      const picker = letter === 's' ? 'element' : letter === 'c' ? 'comment' : null;
      // 这种用法下没有的工具（截图模式的选择元素与评论）不接这两个键，留给浏览器（⇧⌘C 是检查元素）。
      if (mod && event.shiftKey && !event.altKey && picker && markupTools(store.markup.mode).includes(picker)) {
        stop();
        store.apply((s) => setTool(s, picker));
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
        if (!mark || !isOnFrame(mark, frameMs())) return;
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
        if (!alive.current || seq !== pickSeq.current || useMarkup.getState().markup.tool !== 'element') return;
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
    void keepFrame(timeMs, canvasRef.current, liveNow(), capture);
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
    const marks = useMarkup.getState().markup.marks;
    const notes = buildNotes(marks);
    if (!notes?.length) return;
    if (addNotes(notes) === null) return;
    const sent = new Set(notes.map((note) => note.id));
    // 截图先交给草稿再清空：`discard` 把留着的帧一起清了。
    void attachFrames(
      videoId,
      marks.filter((m) => sent.has(m.id)),
      canvasRef.current,
      size,
      C.me,
      liveNow,
      capture,
    );
    // 条数按帧（同一帧的几处标记算一条，lite-editor §4.1）。
    ToastQueue.neutral(C.added(new Set(notes.map(videoAnnotationFrameMs)).size), { timeout: 3000 });
    useMarkup.getState().discard();
  };

  // ---- 截图模式：复制 / 下载这一帧 ----

  /**
   * 这一帧的图（lite-editor §4.1 截图模式）：播放头所在那一帧的画面加上这一帧上的标记（编号按整组数），画法同「添加到对话」的截图。
   * 底图取此刻的画面（就是用户看着的那一帧）；截不出时退回画这一帧标记时留下的那张。都没有（例如实时合成层的页面画不全）时 null。
   */
  const frameShot = async (): Promise<Blob | null> => {
    const nowMs = frameMs();
    const { markup: state, frames } = useMarkup.getState();
    const onThis = sendable(marksOnFrame(state.marks, nowMs));
    if (!onThis.length) return null;
    const source = canvasRef.current;
    const now = source ? await grabFrame(source, liveNow(), capture).catch(() => null) : null;
    const kept = [...onThis].sort((a, b) => Math.abs(a.timeMs - nowMs) - Math.abs(b.timeMs - nowMs)).find((m) => frames[m.timeMs]);
    const base = now ?? (kept ? frames[kept.timeMs] : null);
    return paintFrame(base, onThis, state.marks, nowMs, size, C.me).catch(() => null);
  };
  const shotName = () => {
    const open = useVideo.getState().video;
    return screenshotFileName(open?.state?.video.name ?? open?.ref?.name ?? sequence.name, frameMs());
  };
  /**
   * 复制图片：ClipboardItem 在按下的这一刻同步建好、图片以 Promise 交给它（Safari 要求写剪贴板发生在手势里，画图是异步的）。
   * 被拒时（Claude 内置浏览器拒了剪贴板写权限）退成富文本复制（`copyImageAsHtml`）并如实提示；那也不行时提示改用下载；
   * 是图没截出来时按截不出图提示，这两种标记都留着。复制成了（含富文本）就清掉这一帧的标记（别的帧的留着），不退出。
   */
  const copyImage = () => {
    const shotMs = frameMs();
    const clipboard = typeof ClipboardItem === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard?.write) {
      ToastQueue.negative(C.copyFailed, { timeout: 5000 });
      return;
    }
    const shot = frameShot();
    const png = shot.then((blob) => blob ?? Promise.reject(new Error('frame unavailable')));
    png.catch(() => {});
    void clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
      () => {
        useMarkup.getState().forgetFrame(shotMs);
        ToastQueue.neutral(C.copied, { timeout: 3000 });
      },
      async () => {
        const blob = await shot;
        if (!blob) ToastQueue.neutral(C.captureFailed, { timeout: 4000 });
        else if (await copyImageAsHtml(blob)) {
          useMarkup.getState().forgetFrame(shotMs);
          ToastQueue.neutral(C.copiedAsHtml, { timeout: 8000 });
        } else ToastQueue.negative(C.copyFailed, { timeout: 5000 });
      },
    );
  };
  /** 下载图片：存成 `<视频名>-00m12s400.png`（播放头所在那一帧）。下载出去了就清掉这一帧的标记，同复制。 */
  const downloadImage = () => {
    const shotMs = frameMs();
    const name = shotName();
    void frameShot().then((blob) => {
      if (!blob) {
        ToastQueue.neutral(C.captureFailed, { timeout: 4000 });
        return;
      }
      downloadBlob(blob, name);
      useMarkup.getState().forgetFrame(shotMs);
      ToastQueue.neutral(C.downloaded(name), { timeout: 3000 });
    });
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
    void attachFrames(videoId, [mark], canvasRef.current, size, C.me, liveNow, capture);
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
  const shown = marksOnFrame(markup.marks, nowMs);
  const selected = shown.find((m) => m.id === markup.sel) ?? null;
  const svgMarks = shown.filter((m) => SVG_KINDS.has(m.kind));
  const htmlMarks = shown.filter((m) => !SVG_KINDS.has(m.kind));
  // 文字输入框：改一条已有的照它的颜色与样子，新写的照工具条的当前值。
  const editing = textDraft?.id ? markup.marks.find((m) => m.id === textDraft.id) : undefined;
  const draftColor = editing?.color ?? markup.color;
  const draftLook = textLook(editing ?? { width: markup.width, ...markup.textStyle });

  return (
    <>
      <div
        ref={layerRef}
        className={surface({ isPoint: tool === 'text' || (tool === 'shape' && markup.shape === 'pin'), isPick: picking })}
        style={frame}
        data-markup
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
              className={textMark({ tone: m.color, family: textLook(m).family })}
              style={{ left: pct(m.x), top: pct(m.y), ...textLook(m).style }}
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
            className={textInput({ tone: draftColor, family: draftLook.family })}
            style={{ left: pct(textDraft.x), top: pct(textDraft.y), ...draftLook.style }}
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
      <MarkupBar anchor={layerRef} mode={mode} onAddToChat={addToChat} onCopyImage={copyImage} onDownloadImage={downloadImage} />
      <DialogContainer onDismiss={() => apply((s) => ({ ...s, ask: false }))}>
        {markup.ask ? (
          <AlertDialog
            variant="destructive"
            title={C.discardTitle}
            primaryActionLabel={C.discard}
            cancelLabel={C.keepMarking}
            onPrimaryAction={() => useMarkup.getState().discard()}
            onCancel={() => apply((s) => ({ ...s, ask: false }))}
          >
            {mode === 'screenshot' ? C.discardBodyScreenshot : C.discardBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </>
  );
}

const same = (a: MarkupPick | null, b: MarkupPick | null) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

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
  const C = MARKUP_COPY.pickInfo;
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
  const C = MARKUP_COPY;
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
 * 标记工具条（lite-editor §4.1；照截图标注器）：主工具条一行——选择元素 / 评论 / 画笔 / 形状 ｜ 文字 ｜ 撤销 / 重做 ｜ 标记过的帧▾ ｜
 * 添加到对话 / 关闭；底下隔 2 贴一条副工具条，左端与主工具条对齐，放开着的工具的属性：形状是一排形状，文字是粗体 / 斜体 / 下划线、
 * 字号▾、字体▾，右边（左边有东西时竖线隔开）是颜色▾与粗细▾（文字与评论没有粗细，`hasWidth`）。形状钮不带下拉，显示记住的那一种，
 * 按下就用它画。撤销 / 重做同 ⌘Z / ⇧⌘Z；删选中的不占钮，走 Delete（标记层的键）。挂在 body 下，按 `anchor` 所在舞台的位置浮在
 * 舞台底边上方；下拉与提示挂进工具条这一层（`UNSAFE_PortalProvider`），往上弹时压在主工具条之上。
 * 截图模式（Web）没有评论（`markupTools`），「添加到对话」换成复制图片 / 下载图片，当前帧上没有能出图的标记时两枚都置灰。
 */
export function MarkupBar({
  anchor,
  mode,
  onAddToChat,
  onCopyImage,
  onDownloadImage,
}: {
  anchor: RefObject<HTMLElement | null>;
  mode: MarkupMode;
  onAddToChat: () => void;
  onCopyImage: () => void;
  onDownloadImage: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popContainer = useCallback(() => popRef.current ?? document.body, []);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const stage = anchor.current?.closest<HTMLElement>('[data-preview-stage]') ?? anchor.current;
    const el = barRef.current;
    if (!stage || !el) return;
    const update = () => setPlace(barPlace(stage.getBoundingClientRect(), el.offsetWidth, window.innerWidth, window.innerHeight));
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(stage);
    observer?.observe(el);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, { capture: true, passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, { capture: true });
    };
  }, [anchor]);
  const markup = useMarkup((s) => s.markup);
  const apply = useMarkup((s) => s.apply);
  const nowMs = useEditor((s) => Math.round(s.playhead * 1000));
  const tools = markupTools(mode);
  const C = MARKUP_COPY;
  const keys = (label: string, k?: string) => (k ? C.withKeys(label, keyLabel(k, MAC)) : label);
  /** 切换钮：工具、形状与粗体 / 斜体 / 下划线都是它；`tip` 是提示（带快捷键或当前形状），默认同名字。 */
  const toggle = (key: string, label: string, isSelected: boolean, onChange: () => void, icon: ReactElement, tip = label) => (
    <Tip key={key} label={tip}>
      <RACToggleButton
        className={({ isSelected, isHovered, isPressed, isFocusVisible }) => toolBtn({ isSelected, isHovered, isPressed, isFocusVisible })}
        aria-label={label}
        isSelected={isSelected}
        onChange={onChange}
      >
        {icon}
      </RACToggleButton>
    </Tip>
  );
  const Shape = SHAPE_GLYPHS[markup.shape];
  const toolButton = (tool: MarkupTool, icon: ReactElement) =>
    toggle(
      tool,
      C.tools[tool],
      markup.tool === tool,
      () => apply((s) => setTool(s, tool)),
      icon,
      tool === 'shape' ? C.current(C.tools.shape, C.shapes[markup.shape]) : keys(C.tools[tool], KEYS[tool]),
    );
  /** 带下拉的钮：显示当前值，右边一枚小箭头；是 MenuTrigger 的触发钮。 */
  const menuButton = (label: string, content: ReactNode) => (
    <Tip label={label}>
      <RACButton
        className={({ isHovered, isPressed, isFocusVisible }) => toolBtn({ isHovered, isPressed, isFocusVisible, isMenuTrigger: true })}
        aria-label={label}
      >
        {content}
        <span className={chevronWrap} aria-hidden>
          <ChevronDown UNSAFE_style={chevronFill} />
        </span>
      </RACButton>
    </Tip>
  );
  /** 撤销 / 重做：同 ⌘Z / ⇧⌘Z（标记层的键），无可撤时置灰。 */
  const historyButton = (label: string, k: string, enabled: boolean, step: (s: MarkupState) => MarkupState, icon: ReactElement) => (
    <Tip label={keys(label, k)}>
      <RACButton
        className={({ isHovered, isPressed, isFocusVisible, isDisabled }) => toolBtn({ isHovered, isPressed, isFocusVisible, isDisabled })}
        aria-label={label}
        isDisabled={!enabled}
        onPress={() => apply(step)}
      >
        {icon}
      </RACButton>
    </Tip>
  );
  const count = sendable(markup.marks).length;
  /** 截图模式：当前帧上能出图的标记（别的帧上的不进这一张）。 */
  const onFrameCount = sendable(marksOnFrame(markup.marks, nowMs)).length;
  /** 截图模式的复制 / 下载：与撤销同样的图标钮，名字只在提示与 aria-label 里。 */
  const imageButton = (label: string, onPress: () => void, icon: ReactElement) => (
    <Tip label={label}>
      <RACButton
        className={({ isHovered, isPressed, isFocusVisible, isDisabled }) => toolBtn({ isHovered, isPressed, isFocusVisible, isDisabled })}
        aria-label={label}
        isDisabled={!onFrameCount}
        onPress={onPress}
      >
        {icon}
      </RACButton>
    </Tip>
  );
  const ts = markup.textStyle;
  /** 副工具条左半：开着的工具自己的属性（选择元素、评论、画笔没有）。 */
  const own =
    markup.tool === 'shape' ? (
      <div className={group} role="group" aria-label={C.shapeMenu}>
        {MARKUP_SHAPES.map((shape) => {
          const Glyph = SHAPE_GLYPHS[shape];
          return toggle(
            shape,
            C.shapes[shape],
            markup.shape === shape,
            () => apply((s) => setShape(s, shape)),
            <Glyph styles={toolIcon} />,
          );
        })}
      </div>
    ) : markup.tool === 'text' ? (
      <div className={group}>
        {toggle('bold', C.textStyles.bold, ts.bold, () => apply((s) => setTextStyle(s, { bold: !ts.bold })), <TagBold styles={toolIcon} />)}
        {toggle(
          'italic',
          C.textStyles.italic,
          ts.italic,
          () => apply((s) => setTextStyle(s, { italic: !ts.italic })),
          <TagItalic styles={toolIcon} />,
        )}
        {toggle(
          'underline',
          C.textStyles.underline,
          ts.underline,
          () => apply((s) => setTextStyle(s, { underline: !ts.underline })),
          <TagUnderline styles={toolIcon} />,
        )}
        <MenuTrigger>
          {menuButton(
            C.current(C.fontSize, String(ts.size)),
            <>
              <TextSize styles={toolIcon} />
              <span className={barValue({})}>{ts.size}</span>
            </>,
          )}
          <Menu
            aria-label={C.fontSize}
            selectionMode="single"
            selectedKeys={[ts.size]}
            onAction={(key) => apply((s) => setTextStyle(s, { size: Number(key) as MarkupTextStyle['size'] }))}
          >
            {MARKUP_TEXT_SIZES.map((size) => (
              <MenuItem key={size} id={size} textValue={String(size)}>
                <Text slot="label">{size}</Text>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
        <MenuTrigger>
          {menuButton(C.current(C.font, C.fonts[ts.font]), <span className={barValue({ family: ts.font })}>{C.fonts[ts.font]}</span>)}
          <Menu
            aria-label={C.font}
            selectionMode="single"
            selectedKeys={[ts.font]}
            onAction={(key) => apply((s) => setTextStyle(s, { font: key as MarkupTextStyle['font'] }))}
          >
            {MARKUP_FONTS.map((font) => (
              <MenuItem key={font} id={font} textValue={C.fonts[font]}>
                <Text slot="label">
                  <span className={barValue({ family: font })}>{C.fonts[font]}</span>
                </Text>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      </div>
    ) : null;
  return createPortal(
    <div className={stack} style={place ?? { visibility: 'hidden' }} data-markup-bar onPointerDown={(event) => event.stopPropagation()}>
      <div ref={popRef} className={popLayer} />
      <UNSAFE_PortalProvider getContainer={popContainer}>
        <div ref={barRef} className={bar} role="toolbar" aria-label={C.toolbar}>
          {tools.includes('element') ? toolButton('element', <Select styles={toolIcon} />) : null}
          {tools.includes('comment') ? toolButton('comment', <Comment styles={toolIcon} />) : null}
          {toolButton('pen', <Draw styles={toolIcon} />)}
          {toolButton('shape', <Shape styles={toolIcon} />)}
          <span className={divider} />
          {toolButton('text', <TextIcon styles={toolIcon} />)}
          <span className={divider} />
          {historyButton(C.undo, '⌘Z', canUndo(markup), undo, <UndoIcon styles={toolIcon} />)}
          {historyButton(C.redo, '⇧⌘Z', canRedo(markup), redo, <RedoIcon styles={toolIcon} />)}
          <span className={divider} />
          <MarkBookmarks />
          <span className={divider} />
          {mode === 'screenshot' ? (
            <>
              {imageButton(C.copyImage, onCopyImage, <Copy styles={toolIcon} />)}
              {imageButton(C.downloadImage, onDownloadImage, <Download styles={toolIcon} />)}
            </>
          ) : (
            <Button size="S" variant="primary" isDisabled={!count} onPress={onAddToChat}>
              {C.addToChat}
            </Button>
          )}
          <Tip label={C.close}>
            <ActionButton size="S" isQuiet aria-label={C.close} onPress={() => useMarkup.getState().close()}>
              <Close />
            </ActionButton>
          </Tip>
        </div>
        <div className={bar} role="toolbar" aria-label={C.toolOptions(C.tools[markup.tool])} data-markup-options={markup.tool}>
          {own}
          {own ? <span className={divider} /> : null}
          <MenuTrigger>
            {menuButton(C.current(C.color, C.colors[markup.color]), <span className={swatchDot({ tone: markup.color })} />)}
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
          {hasWidth(markup.tool) ? (
            <MenuTrigger>
              {menuButton(C.current(C.width, C.widthValue(markup.width)), <WidthLine width={markup.width} />)}
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
          ) : null}
        </div>
      </UNSAFE_PortalProvider>
    </div>,
    document.body,
  );
}

/**
 * 标记帧的书签（lite-editor §4.1）：一枚带下拉的钮，列出画过标记的每一帧（时码 · 几处标记），点一项定位到那一帧；播放头所在的那一帧打勾。
 * 时间线上的印章挤在一起时靠它挑。没有标记时置灰。
 */
function MarkBookmarks() {
  const { seek } = useEditorActions();
  const marks = useMarkup((s) => s.markup.marks);
  const frames = useMemo(() => markedFrames(marks), [marks]);
  const nowMs = useEditor((s) => Math.round(s.playhead * 1000));
  const current = currentFrame(frames, nowMs);
  const C = MARKUP_COPY;
  const label = frames.length ? C.current(C.bookmarks, String(frames.length)) : C.bookmarks;
  return (
    <MenuTrigger>
      <Tip label={label}>
        <RACButton
          className={({ isHovered, isPressed, isFocusVisible, isDisabled }) =>
            toolBtn({ isHovered, isPressed, isFocusVisible, isDisabled, isMenuTrigger: true })
          }
          aria-label={label}
          isDisabled={!frames.length}
        >
          <Bookmark styles={toolIcon} />
          <span className={chevronWrap} aria-hidden>
            <ChevronDown UNSAFE_style={chevronFill} />
          </span>
        </RACButton>
      </Tip>
      <Menu
        aria-label={C.bookmarks}
        selectionMode="single"
        selectedKeys={current ? [String(current.timeMs)] : []}
        onAction={(key) => seek(Number(key) / 1000)}
      >
        {frames.map((frame) => {
          const text = C.bookmarkItem(formatTenths(frame.timeMs / 1000), frame.count);
          return (
            <MenuItem key={frame.timeMs} id={String(frame.timeMs)} textValue={text}>
              <Text slot="label">{text}</Text>
            </MenuItem>
          );
        })}
      </Menu>
    </MenuTrigger>
  );
}

/**
 * 工具条一列的落点（视口坐标，左边沿）：主工具条（宽 `width`）对舞台水平居中、底边离舞台底 12；比舞台宽时左右收进窗口 8 以内。
 * 副工具条左端跟着主工具条。
 */
export function barPlace(stage: Pick<DOMRect, 'left' | 'width' | 'bottom'>, width: number, viewW: number, viewH: number): CSSProperties {
  const half = width / 2;
  const center = stage.left + stage.width / 2;
  return { left: Math.max(8 + half, Math.min(viewW - 8 - half, center)) - half, bottom: viewH - stage.bottom + 12 };
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

/**
 * 异步剪贴板写不进图时的退路（lite-editor §4.1 截图模式）：Claude 桌面版的内置浏览器把 `clipboard-write` 权限拒了（`write` 与
 * `writeText` 都是 NotAllowedError，2026-10-21 实测），`document.execCommand('copy')` 仍然可用，但 `copy` 事件里只写得进文字与 HTML，
 * 放进去的文件只落下文件名。于是写一份 HTML：`<img>` 内嵌这张 PNG 的 data 地址——文档、笔记这类收富文本的地方贴得成图，只收图片
 * 文件的地方贴不进去，提示里照实说。要在点按的用户激活还有效时调（Chromium 约 5 秒）；写不进去时 false。
 */
async function copyImageAsHtml(blob: Blob): Promise<boolean> {
  if (typeof document.execCommand !== 'function') return false;
  const url = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
  if (!url?.startsWith('data:image/png;base64,')) return false;
  let wrote = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/html', `<img src="${url}" alt="">`);
    wrote = true;
  };
  document.addEventListener('copy', onCopy, true);
  try {
    return document.execCommand('copy') && wrote;
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
  }
}

/** 此刻的播放头，毫秒整数（标记属于这一帧）。 */
function frameMs(): number {
  return Math.round(useEditor.getState().playhead * 1000);
}

/**
 * 画下第一条标记的那一刻把那一帧拷成 PNG 留在 store 里（同一帧只留第一次；出不了图就不留，「添加到对话」时再提示）。
 * 底下是实时合成层（HTML 动画的 iframe，画布上透明）而宿主能截窗口时截窗口里画面那一块——先把标记层、工具条与草稿标注层藏起来、
 * 等两帧，截完再放回来；宿主不能截窗口（Web）时问实时合成层要这一帧再叠预览画布；否则同步拷预览画布，PNG 编码在后面慢慢做。
 * 此刻的定位若还在路上，截到的是画面上实际那一帧。
 */
async function keepFrame(timeMs: number, source: HTMLCanvasElement | null, live: boolean, capture: CaptureFrame): Promise<void> {
  const store = useMarkup.getState();
  if (!source || store.frames[timeMs]) return;
  const png = await grabFrame(source, live, capture).catch(() => null);
  if (png) useMarkup.getState().keepFrame(timeMs, png);
}
/** 实时合成层露着时怎么截：宿主截窗口（Electron），或问实时合成层要这一帧再叠预览画布（Web）；`canvas` 是序列画布的尺寸。 */
interface CaptureFrame {
  window: HostBridge['captureFrame'];
  live: (() => Promise<LiveFrameShot | null>) | undefined;
  canvas: { width: number; height: number };
}
const OVERLAYS = '[data-markup], [data-video-annotations]';
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
/**
 * 截窗口前要藏起来的东西：舞台里的标记层与草稿标注层，挂在 body 下的工具条，还有评论框——它开在 Popover 里（挂在 body 下的 portal，
 * 不在舞台里，关掉时还有一段退场动画），从它往上取到不包着舞台的最外层一起藏。
 */
function overlaysToHide(stage: HTMLElement | null): HTMLElement[] {
  const found = stage ? [...stage.querySelectorAll<HTMLElement>(OVERLAYS)] : [];
  found.push(...document.querySelectorAll<HTMLElement>('[data-markup-bar]'));
  for (const form of document.querySelectorAll<HTMLElement>('[data-comment-form]')) {
    let top = form;
    while (top.parentElement && top.parentElement !== document.body && !(stage && top.parentElement.contains(stage)))
      top = top.parentElement;
    if (!found.some((el) => el.contains(top))) found.push(top);
  }
  return found;
}
/**
 * 此刻的那一帧：实时合成层露着时截窗口（Electron）；宿主不能截窗口（Web）时问实时合成层要这一帧、垫在预览画布底下合成；
 * 否则拷画布。实时合成层露着而两样都拿不到时画布上是透明的，拷下来只有空白，算截不出图（不把空白当那一帧发出去）。
 */
async function grabFrame(source: HTMLCanvasElement, live: boolean, capture: CaptureFrame): Promise<Blob | null> {
  if (!live) return snapshot(source);
  if (capture.window) return captureWindow(source, capture.window);
  const shot = capture.live ? await capture.live().catch(() => null) : null;
  if (!shot) return null;
  // 画面框的底色：实时层没铺到的地方用户看到的就是它（同 preview.tsx 的 frame）。
  const frameEl = source.parentElement;
  const background = (frameEl && getComputedStyle(frameEl).backgroundColor) || '#000';
  return composeLiveFrame(source, shot, capture.canvas, background);
}
/** 截窗口里预览画面那一块（Electron）：先把标记层、工具条与评论框藏起来、等两帧，截完再放回来。 */
async function captureWindow(source: HTMLCanvasElement, capture: NonNullable<HostBridge['captureFrame']>): Promise<Blob | null> {
  const stage = source.closest<HTMLElement>('[data-preview-stage]') ?? source.parentElement;
  const overlays = overlaysToHide(stage);
  const shown = overlays.map((el) => el.style.visibility);
  for (const el of overlays) el.style.visibility = 'hidden';
  try {
    await nextPaint();
    await nextPaint();
    const r = source.getBoundingClientRect();
    const x = Math.max(0, r.left);
    const y = Math.max(0, r.top);
    const rect = { x, y, width: Math.min(r.right, window.innerWidth) - x, height: Math.min(r.bottom, window.innerHeight) - y };
    if (rect.width <= 0 || rect.height <= 0) return null;
    const bytes = await capture(rect);
    // 主进程送来的字节可能落在共享内存上，拷一份再装进 Blob
    return bytes?.byteLength ? new Blob([bytes.slice()], { type: 'image/png' }) : null;
  } finally {
    overlays.forEach((el, i) => (el.style.visibility = shown[i] ?? ''));
  }
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
 * 截图（lite-editor §4.1）：这组标记涉及的每一帧交给标注草稿一张底图——画那条标记时留下的那一帧（没留下、而播放头还在那一帧上就此刻
 * 截一张，否则这一帧算截不出）——草稿画上这一帧的标记（线条按底图与画面的比例放大，评论画印章，尖角落在点上）存成 PNG，与标注连在一起：
 * 移除标注时重画，发送时作为消息的附件。哪一帧出不了图就提示一次，标注照样已经加了。
 */
async function attachFrames(
  videoId: Id,
  marks: readonly Mark[],
  source: HTMLCanvasElement | null,
  layer: Size,
  initials: string,
  live: () => boolean,
  capture: CaptureFrame,
): Promise<void> {
  const frames = useMarkup.getState().frames;
  const nowMs = frameMs();
  let failed = false;
  for (const timeMs of markFrames(marks)) {
    const onThis = marks.filter((m) => m.timeMs === timeMs);
    // 没留下那一帧的图时只有画面还停在那一帧上才截此刻的：别把另一帧的画面当成这一帧发出去。
    const base =
      frames[timeMs] ??
      (source && Math.abs(timeMs - nowMs) <= VIDEO_ANNOTATION_NEAR_MS ? await grabFrame(source, live(), capture).catch(() => null) : null);
    if (!base) {
      failed = true;
      continue;
    }
    useDraftVideoAnnotations.getState().addShot(videoId, timeMs, { base, layer, initials }, onThis);
  }
  if (failed) ToastQueue.neutral(MARKUP_COPY.shotFailed, { timeout: 4000 });
}
