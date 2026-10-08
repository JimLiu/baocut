import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { AssetRecord, AudioItem, DocumentRecord, Id, Sequence, SequenceItem, Track } from '@baocut/protocol';
import { mediaTimeToSeconds } from '@baocut/protocol';
import { ActionButton, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Animation from '@react-spectrum/s2/icons/Animation';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import ChartBarVert from '@react-spectrum/s2/icons/ChartBarVert';
import Clock from '@react-spectrum/s2/icons/Clock';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import Emoji from '@react-spectrum/s2/icons/Emoji';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import Layers from '@react-spectrum/s2/icons/Layers';
import Lock from '@react-spectrum/s2/icons/Lock';
import LockOpen from '@react-spectrum/s2/icons/LockOpen';
import Shapes from '@react-spectrum/s2/icons/Shapes';
import TextIcon from '@react-spectrum/s2/icons/Text';
import TextNumbers from '@react-spectrum/s2/icons/TextNumbers';
import Translate from '@react-spectrum/s2/icons/Translate';
import Video from '@react-spectrum/s2/icons/Video';
import Visibility from '@react-spectrum/s2/icons/Visibility';
import VisibilityOff from '@react-spectrum/s2/icons/VisibilityOff';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  clipKind,
  durationSeconds,
  formatTimecode,
  frameAt,
  itemFrames,
  itemLabel,
  rulerLabel,
  rulerStep,
  snapTargets,
  stackingGroup,
  timelineRows,
  type ClipKind,
} from '../../model/editor.ts';
import { captionKindLabel } from '../../model/caption-tracks.ts';
import { importAndPlace, isPlaceable, moveOperation, placeAsset, trimBounds, trimOperation } from '../../model/editor-ops.ts';
import { kindOfFileName } from '../../model/space.ts';
import type { Rect } from '../../model/stage-pose.ts';
import {
  dubTrackGroup,
  roomAfter,
  stemTrackOf,
  stretchChanged,
  stretchSpeed,
  type DubBlock,
  type DubGroup,
  type Stretch,
} from '../../model/timeline-dub.ts';
import { marqueeItems, marqueeSelection, type MarqueeLane } from '../../model/timeline-marquee.ts';
import { rulerTicks, spanIndex, spansIn, type SpanIndex } from '../../model/timeline-window.ts';
import { anchoredScroll, clipSpanAt, selectionSpan, zoomFloor, zoomPlan, type ZoomAction } from '../../model/timeline-zoom.ts';
import { langName } from '../../model/tools-models.ts';
import { headTags, subtitleTrackLanguage, type HeadLanguage } from '../../model/track-heads.ts';
import { TIMELINE_ZOOM_COPY as ZOOM_COPY } from '../../copy.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { ClipMedia } from './clip-media.tsx';
import { DUB_REGEN_COPY, TIMELINE_DUB_COPY as DUB_COPY } from './dub-copy.ts';
import { useEditorActions } from './editor-context.tsx';
import { Marquee } from './stage-boxes.tsx';
import { TimelineChapters } from './timeline-chapters.tsx';
import { CaptionCues } from './timeline-cues.tsx';
import { LiveCaptionRow, TranscriptRow, useLiveRows, useTranscriptRows } from './timeline-live.tsx';
import { DubBlockView, stretchedLook, useDubBlocks } from './timeline-dub.tsx';
import { DubHeadMenu, useDubTrack } from './timeline-dub-head.tsx';
import { TimelineMenu, type TimelineMenuTarget } from './timeline-menu.tsx';
import { CutBands } from './timeline-seams.tsx';
import { useVisibleLane } from './use-visible-lane.ts';
import './editor.css';
import { EDITOR_COPY as E } from './editor-copy.ts';

/** 拖素材时用的数据类型：素材面板 → 时间线。 */
export const ASSET_DRAG_TYPE = 'application/x-baocut-asset';

/** 行头列宽（原型 144）。 */
const HEAD = 144;
/** 泳道左右的内边距；style 宏要能静态求值，写字面量，与 model/timeline-zoom 的 ZOOM_PAD 同值。 */
const PAD = 12;
const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const RULER = 24;
/**
 * 行高：放视频的画面行要画胶片条与原声波形，高一些；别的行（图片、文字、声音、配音、字幕）看不到缩略图，一样矮，与字幕行同高
 * （原型 LANE_H，2026-10-08）。
 */
const MEDIA_ROW_HEIGHT = 64;
const ROW_HEIGHT = 40;
/** 吸附阈值（像素，原型 10px）。 */
const SNAP_PX = 10;
/** 按下后移动超过这么多像素才算拖动。 */
const DRAG_PX = 3;
/** 视频片段窄于这个宽度就不画胶片条与波形，只留色块。 */
const MEDIA_MIN_PX = 12;
/** 在空白处按下后拖过这么多像素才算框选，否则是一次点空白（设计稿 timeline.jsx `beginMarquee`）。 */
const MARQUEE_PX = 4;

/**
 * 时间线自己摆滚动位置（缩放、播放跟随）：设完当场补发一次 `scroll`，看得见的范围（useVisibleLane）在画上去之前就换好，
 * 不等浏览器下一帧才派发的那次（窗口在后台时还可能不派发）。
 */
function scrollLaneTo(element: HTMLDivElement, left: number) {
  element.scrollLeft = left;
  element.dispatchEvent(new Event('scroll'));
}

const root = style({ display: 'flex', flexDirection: 'column', minHeight: 0, flexShrink: 0, backgroundColor: 'gray-25' });
const scroller = style({ position: 'relative', flexGrow: 1, minHeight: 0, overflow: 'auto' });
const rulerRow = style({ position: 'sticky', top: 0, zIndex: 3, display: 'flex', height: RULER, backgroundColor: 'gray-25' });
const corner = style({
  position: 'sticky',
  insetStart: 0,
  zIndex: 4,
  flexShrink: 0,
  boxSizing: 'border-box',
  width: HEAD,
  backgroundColor: 'gray-25',
  borderEndWidth: 1,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderStyle: 'solid',
  borderBottomWidth: 1,
  borderColor: 'gray-200',
});
const rulerLane = style({
  position: 'relative',
  flexShrink: 0,
  cursor: 'pointer',
  borderBottomWidth: 1,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  userSelect: 'none',
});
const tick = style({ position: 'absolute', bottom: 0, width: 1, backgroundColor: 'gray-400' });
const tickLabel = style({ position: 'absolute', top: 2, font: 'ui-xs', color: 'gray-600', whiteSpace: 'nowrap', paddingStart: 4 });
/** 行与行之间不画线（同原型），靠行头列与片段区分。 */
const row = style({ position: 'relative', display: 'flex' });
/** 拖行头换顺序时，落点那一行上缘或下缘的一条线。 */
const trackDropLine = style({ position: 'absolute', insetStart: 0, insetEnd: 0, height: 2, backgroundColor: 'blue-800', zIndex: 3, pointerEvents: 'none' });
/** 行头：类别图标 + 名字，开关靠右（原型 `.trow__hd`）；停用的行连名字一起降低强调。 */
const header = style({
  position: 'sticky',
  insetStart: 0,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  gap: '[6px]',
  flexShrink: 0,
  width: HEAD,
  paddingStart: 12,
  paddingEnd: 4,
  boxSizing: 'border-box',
  backgroundColor: 'gray-25',
  borderEndWidth: 1,
  borderTopWidth: 0,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui-xs',
  color: { default: 'gray-700', isOff: 'gray-400' },
  cursor: { default: 'default', isDraggable: 'grab' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const headerLabel = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
/** 字幕行与配音行的语言标签（ZH、EN、PT-BR，原型 `.thd__lang`）：任何界面语言下都放得下，全名在悬停说明里。 */
const headerTag = style({
  flexShrink: 0,
  marginEnd: 'auto',
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: 'gray-200',
  fontWeight: 'bold',
  lineHeight: '[16px]',
  whiteSpace: 'nowrap',
});
const headerToggles = style({ display: 'flex', alignItems: 'center', flexShrink: 0 });
/**
 * 配音行头「有句过快或没合成」的小黄点（设计稿 `.thd__fast`：不是出错，不用橙红）。行头只有 144px，点占在名字后面会把
 * 「配音 · 英语」挤成省略号，所以挂在轨道图标的右上角，不占名字的地方。
 */
const headerFlag = style({
  position: 'absolute',
  top: '[calc(50% - 9px)]',
  insetStart: '[26px]',
  width: 6,
  height: 6,
  borderRadius: 'full',
  backgroundColor: 'yellow-700',
});
const TRACK_ICON: Record<Track['kind'], typeof Video> = { visual: Layers, audio: AudioWave, subtitle: CloseCaptions };
/**
 * 一条轨的片段区。片段与配音块的字体在这里设、由它们继承（轨里别的字都自带字体：读数、字幕块）。
 * 整片入镜一次挂上几千个片段与配音块，元素上样式宏的原子类越多样式计算越慢；所以片段只留随状态变的几项在样式宏里，
 * 不变的几何与排版放在 editor.css 的 `.bc-clip`，字体靠继承。
 */
const lane = style({
  position: 'relative',
  flexShrink: 0,
  font: 'ui-xs',
  backgroundColor: { default: 'transparent', isDropTarget: 'blue-100' },
});
/** 片段随色相与状态变的部分；位置、圆角、边框线型、裁切、排版在 editor.css 的 `.bc-clip` / `.bc-clip-item`，字体继承自轨。 */
const clip = style({
  borderWidth: { default: 1, isSelected: 2 },
  cursor: { default: 'grab', isLocked: 'not-allowed' },
  backgroundColor: {
    hue: {
      yellow: { default: 'yellow-200', isSelected: 'yellow-300' },
      orange: { default: 'orange-200', isSelected: 'orange-300' },
      purple: { default: 'purple-200', isSelected: 'purple-300' },
      green: { default: 'green-200', isSelected: 'green-300' },
      cyan: { default: 'cyan-200', isSelected: 'cyan-300' },
      magenta: { default: 'magenta-200', isSelected: 'magenta-300' },
      indigo: { default: 'indigo-200', isSelected: 'indigo-300' },
      blue: { default: 'blue-200', isSelected: 'blue-300' },
    },
  },
  borderColor: {
    hue: {
      yellow: { default: 'yellow-400', isSelected: 'yellow-800' },
      orange: { default: 'orange-400', isSelected: 'orange-800' },
      purple: { default: 'purple-400', isSelected: 'purple-800' },
      green: { default: 'green-400', isSelected: 'green-800' },
      cyan: { default: 'cyan-400', isSelected: 'cyan-800' },
      magenta: { default: 'magenta-400', isSelected: 'magenta-800' },
      indigo: { default: 'indigo-400', isSelected: 'indigo-800' },
      blue: { default: 'blue-400', isSelected: 'blue-800' },
    },
  },
  color: {
    hue: {
      yellow: 'yellow-1100',
      orange: 'orange-1100',
      purple: 'purple-1100',
      green: 'green-1100',
      cyan: 'cyan-1100',
      magenta: 'magenta-1100',
      indigo: 'indigo-1100',
      blue: 'blue-1100',
    },
  },
  opacity: { default: 1, isDisabled: 0.5 },
});
type ClipHue = 'yellow' | 'orange' | 'purple' | 'green' | 'cyan' | 'magenta' | 'indigo' | 'blue';
/** 每类块的色相与图标（同旧版网页时间线的 `elementHue` / `elementIcon`）。 */
const CLIP_LOOKS: Record<ClipKind, { hue: ClipHue; icon: typeof Video }> = {
  video: { hue: 'yellow', icon: Video },
  image: { hue: 'orange', icon: ImageIcon },
  audio: { hue: 'blue', icon: AudioWave },
  text: { hue: 'orange', icon: TextIcon },
  shape: { hue: 'green', icon: Shapes },
  composition: { hue: 'indigo', icon: Animation },
  caption: { hue: 'purple', icon: CloseCaptions },
  counter: { hue: 'orange', icon: TextNumbers },
  progress: { hue: 'cyan', icon: Clock },
  sticker: { hue: 'purple', icon: Emoji },
  visualizer: { hue: 'magenta', icon: ChartBarVert },
  // 元素模型新增的几类：先借用已有的色相与图标。
  confetti: { hue: 'purple', icon: Animation },
  draw: { hue: 'green', icon: Shapes },
  placeholder: { hue: 'yellow', icon: Layers },
  whiteboard: { hue: 'orange', icon: ImageIcon },
};
const clipIcon = iconStyle({ size: 'XS' });
const clipTitle = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 });
const clipName = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 'bold' });
const clipMeta = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75 });
const ghost = style({
  position: 'absolute',
  top: 4,
  bottom: 4,
  boxSizing: 'border-box',
  borderRadius: 'sm',
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: 'gray-500',
  opacity: 0.45,
  pointerEvents: 'none',
});
const readout = style({
  position: 'absolute',
  top: -2,
  zIndex: 5,
  font: 'ui-xs',
  color: 'white',
  backgroundColor: 'gray-800',
  borderRadius: 'sm',
  paddingX: 4,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
});
const emptyBox = style({
  position: 'absolute',
  top: 8,
  bottom: 8,
  insetStart: PAD,
  width: 360,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: 'gray-300',
  borderRadius: 'lg',
  font: 'ui-sm',
  color: 'gray-600',
  pointerEvents: 'none',
});

/** 拖行头的落点：同一叠里的另一行，放在它显示上的上面还是下面。 */
interface TrackDrop {
  trackId: Id;
  position: 'above' | 'below';
}

/**
 * 时间线上的上下 → `moveTrack` 的上下：画面与字幕行按 `order` 从高到低排（上面的在前面），声音行从低到高
 * （model/editor.ts 的 `trackRows`），所以声音行的「上面」是 `order` 更小的那边。
 */
function trackPlacement(kind: Track['kind'], position: TrackDrop['position']): 'above' | 'below' {
  if (stackingGroup(kind) === 'picture') return position;
  return position === 'above' ? 'below' : 'above';
}

/** 拖到紧挨着自己的行、又落在靠自己的那一边：位置不变，不算换。 */
function trackDropChanges(rows: readonly { track: Track }[], trackId: Id, drop: TrackDrop): boolean {
  const from = rows.findIndex((row) => row.track.id === trackId);
  const to = rows.findIndex((row) => row.track.id === drop.trackId);
  if (from < 0 || to < 0) return false;
  if (drop.position === 'above' && to === from + 1) return false;
  if (drop.position === 'below' && to === from - 1) return false;
  return true;
}

type Gesture =
  | {
      kind: 'move';
      itemId: Id;
      itemIds: Id[];
      originX: number;
      started: boolean;
      deltaFrames: number;
      trackId: Id | null;
      /** 换轨道时片段在原来那一行里纵向挪多少像素（元素不换父节点，指针捕获不断）。 */
      offsetY: number;
      snap: number | null;
    }
  | { kind: 'trim'; itemId: Id; edge: 'start' | 'end'; frame: number; snap: number | null }
  | {
      /** 按住行头拖，换这条轨道在同一叠里的上下：目标是同一叠（画面与字幕一叠、声音一叠）的另一行，放在它上面或下面（显示上的上下）。 */
      kind: 'track';
      trackId: Id;
      originY: number;
      started: boolean;
      /** 行跟着指针挪多少像素。 */
      offsetY: number;
      target: TrackDrop | null;
    }
  /** 拖配音块的右缘改语速：松手一次 `setSpeed`。`room` 是到同轨下一件起点的长度。 */
  | { kind: 'stretch'; itemId: Id; originX: number; seconds0: number; room: number | null; stretch: Stretch | null }
  | {
      /** 在空白处拖出矩形框选：起点记成时间（缩放了也不漂）与内容坐标里的纵向位置；当前点按最后一次指针位置算。 */
      kind: 'marquee';
      t0: number;
      y0: number;
      t1: number;
      y1: number;
      clientX: number;
      clientY: number;
      /** 按着 ⇧ / ⌘ / Ctrl：并入原选区。 */
      additive: boolean;
      started: boolean;
    };

export interface TimelineHandle {
  /** 缩放动作（走带的缩放菜单、按钮与快捷键共用这一处）：要用到泳道宽、滚动位置与播放头。 */
  zoom(action: ZoomAction): void;
}

export function Timeline({
  videoId,
  sequence,
  assets,
  documents,
  height,
  handle,
}: {
  videoId: Id | null;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
  height: number;
  handle: { current: TimelineHandle | null };
}) {
  const runtime = useRuntime();
  const { apply, seek } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const pps = useEditor((s) => s.pxPerSecond);
  const selection = useEditor((s) => s.selection);
  // ⌥←/→ 还没提交的微调：按同一个视频版本画位移，版本变了（提交落地）就不再叠加。
  const nudge = useEditor((s) => s.nudge);
  const revision = useVideo((s) => s.video?.state?.video.revision);
  const nudged = nudge && nudge.revision === revision ? nudge : null;
  const [menu, setMenu] = useState<TimelineMenuTarget | null>(null);
  const { select, toggleSelect, setZoom } = useEditor.getState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef(new Map<Id, HTMLDivElement>());
  // 时间线滚动区的宽（含行头列）；ResizeObserver 量出来之前是 null。
  const [measured, setViewport] = useState<number | null>(null);
  const viewport = measured ?? 800;
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  // 指针事件可能比重绘来得快：手势以 ref 为准，state 只用来重画。
  const gestureRef = useRef<Gesture | null>(null);
  const setGesture = (next: Gesture | null) => {
    gestureRef.current = next;
    setGestureState(next);
  };
  const [dropTrack, setDropTrack] = useState<Id | null>(null);
  const fps = sequence.fps;
  const perSecond = fps.num / fps.den;
  const rows = useMemo(() => timelineRows(sequence), [sequence]);
  // 放视频的画面行（高一些，见 MEDIA_ROW_HEIGHT）。
  const mediaTracks = useMemo(() => new Set(sequence.items.filter((item) => item.type === 'video').map((item) => item.trackId)), [sequence]);
  const rowHeight = (track: Track) => (track.kind === 'visual' && mediaTracks.has(track.id) ? MEDIA_ROW_HEIGHT : ROW_HEIGHT);
  // 字幕行与配音行头上的语言标签，字幕行是原文还是译文（model/track-heads.ts）。
  const heads = useMemo(() => {
    const languages: HeadLanguage[] = [];
    const kinds = new Map<Id, 'original' | 'translation'>();
    for (const { track } of rows) {
      if (track.kind === 'subtitle') {
        const info = subtitleTrackLanguage(sequence, track, documents);
        if (!info) continue;
        kinds.set(track.id, info.kind);
        languages.push({ trackId: track.id, group: 'subtitle', language: info.language });
      } else if (track.kind === 'audio') {
        const group = dubTrackGroup(sequence, track.id);
        if (group) languages.push({ trackId: track.id, group: 'dub', language: group.language });
      }
    }
    return { tags: headTags(languages), kinds };
  }, [rows, sequence, documents]);
  const duration = durationSeconds(sequence);
  const laneWidth = Math.max(viewport - HEAD, PAD * 2 + (duration + 30) * pps);
  const tracks = useMemo(() => new Map(sequence.tracks.map((t) => [t.id, t])), [sequence.tracks]);
  const items = useMemo(() => new Map(sequence.items.map((i) => [i.id, i])), [sequence.items]);
  // 每条轨的件按起点排好：只画与看得见的时间窗相交的那几件（model/timeline-window.ts）。
  const lanes = useMemo(() => {
    const byTrack = new Map<Id, SequenceItem[]>();
    for (const item of sequence.items) {
      const list = byTrack.get(item.trackId);
      if (list) list.push(item);
      else byTrack.set(item.trackId, [item]);
    }
    return new Map<Id, SpanIndex<SequenceItem>>([...byTrack].map(([id, list]) => [id, spanIndex(list, (item) => itemFrames(item, fps))]));
  }, [sequence.items, fps]);
  const dubs = useDubBlocks(sequence, documents, assets);
  // 第一次转录时还没有字幕轨：识别出来的段落先画在一条临时行里（timeline-live.tsx）。
  const liveRows = useLiveRows(videoId, sequence, documents);
  // 转录过、却一条字幕轨都没有（转录时没建字幕层）：文稿画在一条只读行里，时间线不是空的。
  const transcripts = useTranscriptRows(sequence, documents, liveRows);
  // 看得见的横向范围（泳道坐标，像素），左右各多一屏：滚动、缩放、播放翻页时不露白。
  const view = useVisibleLane(scrollRef, HEAD, 1);

  const xOf = (seconds: number) => PAD + seconds * pps;
  const xOfFrame = (frame: number) => xOf(frame / perSecond);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setViewport(entry?.contentRect.width ?? 800));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 缩小的下限跟着时长与泳道宽走：长视频能缩到整片入镜。量出泳道宽之前不写，免得拿猜的宽度把记着的缩放夹走。
  useEffect(() => {
    if (measured !== null) useEditor.getState().setZoomFloor(zoomFloor(duration, measured - HEAD));
  }, [measured, duration]);

  // 缩放之后的滚动位置：按新的每秒像素数算，在新宽度画上去之后（useLayoutEffect）设。
  // ⌘/Ctrl + 滚轮缩放以指针下的时间为锚点。React 的 wheel 监听是被动的，这里自己挂。
  const zoomAnchor = useRef<((pps: number) => number) | null>(null);
  /** 换缩放并按 `scrollFor` 摆滚动位置；缩放被夹住没变时直接摆，不留下过期的锚。 */
  const zoomTo = (next: number, scrollFor: (pps: number) => number) => {
    const before = useEditor.getState().pxPerSecond;
    zoomAnchor.current = scrollFor;
    setZoom(next);
    const after = useEditor.getState().pxPerSecond;
    if (after !== before) return;
    zoomAnchor.current = null;
    const element = scrollRef.current;
    if (element) scrollLaneTo(element, scrollFor(after));
  };
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left - HEAD;
      const current = useEditor.getState().pxPerSecond;
      const seconds = (element.scrollLeft + x - PAD) / current;
      // zoomTo 只碰 ref 与 store，首次渲染的这一份一直可用。
      zoomTo(current * Math.exp(-event.deltaY / 300), (next) => anchoredScroll(seconds, x, next));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 没有锚（下限夹住了缩放）也补发一次 scroll：内容变窄时浏览器夹住的滚动位置要当场换成新的可见范围。
  useLayoutEffect(() => {
    const scrollFor = zoomAnchor.current;
    const element = scrollRef.current;
    if (!element) return;
    zoomAnchor.current = null;
    scrollLaneTo(element, scrollFor ? scrollFor(pps) : element.scrollLeft);
  }, [pps]);

  handle.current = {
    zoom: (action) => {
      const element = scrollRef.current;
      if (!element) return;
      const { pxPerSecond, playhead, selection: selected } = useEditor.getState();
      const span =
        action === 'fitClip'
          ? clipSpanAt(sequence, selected, playhead)
          : action === 'fitSelection'
            ? selectionSpan(sequence, selected)
            : null;
      if (action === 'fitClip' && !span) return void ToastQueue.neutral(ZOOM_COPY.noClip, { timeout: 2500 });
      if (action === 'fitSelection' && !span) return void ToastQueue.neutral(ZOOM_COPY.noSelection, { timeout: 2500 });
      const lane = (measured ?? element.clientWidth) - HEAD;
      const plan = zoomPlan(action, { pxPerSecond, scroll: element.scrollLeft, lane, duration, playhead }, span);
      if (!plan) return;
      // 计划里的滚动按计划的缩放算；store 夹出来的值与它不同（下限还没写入）时按同一个锚重算。
      const anchor = (plan.scroll + lane / 2 - PAD) / plan.pxPerSecond;
      zoomTo(plan.pxPerSecond, (next) => (next === plan.pxPerSecond ? plan.scroll : anchoredScroll(anchor, lane / 2, next)));
    },
  };

  // ---- 坐标 ----

  const frameAtClientX = (clientX: number) => {
    const element = scrollRef.current;
    if (!element) return 0;
    const x = clientX - element.getBoundingClientRect().left - HEAD + element.scrollLeft;
    return Math.max(0, ((x - PAD) / pps) * perSecond);
  };
  const trackAtClientY = (clientY: number): Track | null => {
    for (const [id, element] of laneRefs.current) {
      const rect = element.getBoundingClientRect();
      if (clientY >= rect.top && clientY < rect.bottom) return tracks.get(id) ?? null;
    }
    return null;
  };
  /** 视口坐标 → 时间线内容坐标（随滚动走的那一层：左边含行头列，上边含刻度尺）。 */
  const contentPoint = (clientX: number, clientY: number) => {
    const element = scrollRef.current;
    if (!element) return { x: 0, y: 0 };
    const rect = element.getBoundingClientRect();
    return { x: clientX - rect.left - element.clientLeft + element.scrollLeft, y: clientY - rect.top - element.clientTop + element.scrollTop };
  };
  /** 各行在内容坐标里的纵向位置（量 DOM：行的 offsetParent 就是内容层）。 */
  const measureLanes = (): MarqueeLane[] =>
    rows.flatMap(({ track }) => {
      const element = laneRefs.current.get(track.id);
      return element ? [{ trackId: track.id, top: element.offsetTop, height: element.offsetHeight }] : [];
    });
  const marqueeRect = (g: Extract<Gesture, { kind: 'marquee' }>): Rect => {
    const x0 = HEAD + xOf(g.t0);
    const x1 = HEAD + xOf(g.t1);
    return { x: Math.min(x0, x1), y: Math.min(g.y0, g.y1), w: Math.abs(x1 - x0), h: Math.abs(g.y1 - g.y0) };
  };
  const snapThreshold = (SNAP_PX / pps) * perSecond;

  /** 在阈值内吸附到最近的目标；`edges` 是正在动的边（帧），返回要补的偏移。 */
  const snapOffset = (edges: number[], targets: number[]): { offset: number; at: number | null } => {
    let best: { offset: number; at: number } | null = null;
    for (const edge of edges) {
      for (const target of targets) {
        const offset = target - edge;
        if (Math.abs(offset) <= snapThreshold && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset, at: target };
      }
    }
    return best ?? { offset: 0, at: null };
  };

  // ---- 手势 ----
  // 按下后在 window 上跟踪移动与松开，不依赖元素的指针捕获：拖动中窗口失焦会丢掉捕获，指针也可能离开片段。
  // 没收到松开（在别的窗口里松开了）就作废，不提交。

  const onClipPointerDown = (event: ReactPointerEvent<HTMLDivElement>, item: SequenceItem) => {
    // 右键（以及 macOS 上的 ⌃点按）开菜单，不动选区、不起手势（见 onClipContextMenu）。
    if (event.button !== 0 || (MAC && event.ctrlKey)) {
      event.stopPropagation();
      return;
    }
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      toggleSelect(item.id);
      return;
    }
    const group = selection.includes(item.id) ? selection : [item.id];
    if (!selection.includes(item.id)) select([item.id]);
    if (!editable || item.locked || tracks.get(item.trackId)?.locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({
      kind: 'move',
      itemId: item.id,
      itemIds: group,
      originX: event.clientX,
      started: false,
      deltaFrames: 0,
      trackId: null,
      offsetY: 0,
      snap: null,
    });
  };

  /** 右键片段：没选中它就先只选它（原型 timeline-menu.jsx），菜单开在指针处。 */
  const onClipContextMenu = (event: ReactMouseEvent<HTMLDivElement>, item: SequenceItem) => {
    event.preventDefault();
    event.stopPropagation();
    if (gestureRef.current) return;
    if (!useEditor.getState().selection.includes(item.id)) select([item.id]);
    setMenu({ itemId: item.id, x: event.clientX, y: event.clientY });
  };

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, item: SequenceItem, edge: 'start' | 'end') => {
    if (event.button !== 0) return;
    event.stopPropagation();
    select([item.id]);
    if (!editable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const range = itemFrames(item, fps);
    setGesture({ kind: 'trim', itemId: item.id, edge, frame: Math.round(edge === 'start' ? range.start : range.end), snap: null });
  };

  /** 配音块的右缘：拖它改这一句的语速（设计稿 timeline-dub.jsx `beginStretch`）。 */
  const onStretchPointerDown = (event: ReactPointerEvent<HTMLDivElement>, item: AudioItem) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    select([item.id]);
    if (!editable || item.locked || tracks.get(item.trackId)?.locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({
      kind: 'stretch',
      itemId: item.id,
      originX: event.clientX,
      seconds0: mediaTimeToSeconds(item.playDuration),
      room: roomAfter(sequence, item),
      stretch: null,
    });
  };

  /** 同一叠（画面与字幕一叠、声音一叠）的行不止一条时行头可以拖着换顺序（锁着的不拖，只读时不拖）。 */
  const canDragTrack = (track: Track) =>
    editable && !track.locked && rows.filter((r) => stackingGroup(r.track.kind) === stackingGroup(track.kind)).length > 1;

  /** 按住行头：拖起来就换这条轨道的上下（设计稿里行头可拖）。按在开关钮上不算。 */
  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>, track: Track) => {
    if (event.button !== 0 || !canDragTrack(track)) return;
    if ((event.target as HTMLElement).closest('button, [role="button"], input')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ kind: 'track', trackId: track.id, originY: event.clientY, started: false, offsetY: 0, target: null });
  };

  /** 在轨道区空白处按下：拖出矩形就框选，没拖起来就是点空白（清选区；按着修饰键时不动）。片段、行头、刻度尺自己拦下了按下。 */
  const onBlankPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    if (event.button !== 0 || (MAC && event.ctrlKey) || !element) return;
    const rect = element.getBoundingClientRect();
    // 按在滚动条上不算。
    if (event.clientX - rect.left - element.clientLeft >= element.clientWidth || event.clientY - rect.top - element.clientTop >= element.clientHeight) return;
    const p = contentPoint(event.clientX, event.clientY);
    const t = (p.x - HEAD - PAD) / pps;
    setGesture({
      kind: 'marquee',
      t0: t,
      y0: p.y,
      t1: t,
      y1: p.y,
      clientX: event.clientX,
      clientY: event.clientY,
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      started: false,
    });
  };

  /** 框选的当前点跟着指针（拖动中滚动了也按最后一次指针位置重算）。 */
  const marqueeTo = (gesture: Extract<Gesture, { kind: 'marquee' }>, clientX: number, clientY: number) => {
    const p = contentPoint(clientX, clientY);
    const t1 = (p.x - HEAD - PAD) / pps;
    const started = gesture.started || Math.max(Math.abs(t1 - gesture.t0) * pps, Math.abs(p.y - gesture.y0)) >= MARQUEE_PX;
    setGesture({ ...gesture, t1, y1: p.y, clientX, clientY, started });
  };

  const onGestureMove = (event: PointerEvent) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.kind === 'marquee') return marqueeTo(gesture, event.clientX, event.clientY);
    if (gesture.kind === 'stretch') {
      const item = items.get(gesture.itemId);
      if (item?.type !== 'audio') return;
      const want = gesture.seconds0 + (event.clientX - gesture.originX) / pps;
      setGesture({ ...gesture, stretch: stretchSpeed(item, want, gesture.room) });
      return;
    }
    if (gesture.kind === 'track') {
      const dy = event.clientY - gesture.originY;
      if (!gesture.started && Math.abs(dy) < DRAG_PX) return;
      // 落点取指针所在的同一叠的行；指针在行与行的缝里、或拖出了最上 / 最下一行（底下那行常被裁掉一截）时取最近的一行，按在它上半还是下半分上下。
      const own = tracks.get(gesture.trackId);
      let target: TrackDrop | null = null;
      let nearest = Number.POSITIVE_INFINITY;
      for (const [id, element] of laneRefs.current) {
        const kind = tracks.get(id)?.kind;
        if (id === gesture.trackId || !kind || !own || stackingGroup(kind) !== stackingGroup(own.kind)) continue;
        const rect = element.getBoundingClientRect();
        const middle = (rect.top + rect.bottom) / 2;
        const distance = Math.abs(event.clientY - middle);
        if (distance >= nearest) continue;
        nearest = distance;
        target = { trackId: id, position: event.clientY < middle ? 'above' : 'below' };
      }
      if (target && !trackDropChanges(rows, gesture.trackId, target)) target = null;
      setGesture({ ...gesture, started: true, offsetY: dy, target });
      return;
    }
    const playheadFrame = frameAt(useEditor.getState().playhead, fps);
    if (gesture.kind === 'move') {
      const dx = event.clientX - gesture.originX;
      if (!gesture.started && Math.abs(dx) < DRAG_PX) return;
      const moved = gesture.itemIds.map((id) => items.get(id)).filter((i): i is SequenceItem => !!i);
      const grabbed = items.get(gesture.itemId);
      if (!grabbed) return;
      let delta = Math.round((dx / pps) * perSecond);
      const range = itemFrames(grabbed, fps);
      const snapped = snapOffset([range.start + delta, range.end + delta], snapTargets(sequence, playheadFrame, new Set(gesture.itemIds)));
      delta += Math.round(snapped.offset);
      const earliest = Math.min(...moved.map((i) => itemFrames(i, fps).start));
      delta = Math.max(delta, -Math.floor(earliest));
      const over = moved.length === 1 ? trackAtClientY(event.clientY) : null;
      const trackId = over && over.kind === tracks.get(grabbed.trackId)?.kind && !over.locked ? over.id : null;
      const from = laneRefs.current.get(grabbed.trackId)?.getBoundingClientRect().top ?? 0;
      const to = trackId ? (laneRefs.current.get(trackId)?.getBoundingClientRect().top ?? from) : from;
      setGesture({ ...gesture, started: true, deltaFrames: delta, trackId, offsetY: to - from, snap: snapped.at });
      return;
    }
    const item = items.get(gesture.itemId);
    if (!item) return;
    const raw = frameAtClientX(event.clientX);
    const snapped = snapOffset([raw], snapTargets(sequence, playheadFrame, new Set([item.id])));
    const range = itemFrames(item, fps);
    const bounds = trimBounds(item, assets, sequence);
    let frame = Math.round(raw + snapped.offset);
    frame =
      gesture.edge === 'start'
        ? Math.min(Math.max(frame, bounds.min), Math.ceil(range.end) - 1)
        : Math.max(Math.min(frame, bounds.max), Math.floor(range.start) + 1);
    setGesture({ ...gesture, frame, snap: snapped.at === frame ? snapped.at : null });
  };

  const onGestureEnd = () => {
    const done = gestureRef.current;
    setGesture(null);
    if (!done) return;
    if (done.kind === 'marquee') {
      if (!done.started) {
        if (!done.additive) select([]);
        return;
      }
      const hits = marqueeItems(sequence, { head: HEAD, pad: PAD, pxPerSecond: pps, lanes: measureLanes() }, marqueeRect(done));
      select(marqueeSelection(useEditor.getState().selection, hits, done.additive));
      return;
    }
    if (done.kind === 'stretch') {
      const item = items.get(done.itemId);
      if (item?.type === 'audio' && done.stretch && stretchChanged(item, done.stretch)) {
        void apply([{ type: 'setSpeed', sequenceId: sequence.id, itemId: item.id, rate: done.stretch.rate }], DUB_COPY.labelStretch);
      }
      return;
    }
    if (done.kind === 'track') {
      const track = tracks.get(done.trackId);
      if (!done.started || !done.target || !track) return;
      void apply(
        [
          {
            type: 'moveTrack',
            sequenceId: sequence.id,
            trackId: done.trackId,
            target: done.target.trackId,
            position: trackPlacement(track.kind, done.target.position),
          },
        ],
        E.moveTrack,
      );
      return;
    }
    if (done.kind === 'move') {
      if (!done.started) return;
      const operation = moveOperation(sequence, {
        itemId: done.itemId,
        itemIds: done.itemIds,
        deltaFrames: done.deltaFrames,
        trackId: done.trackId,
      });
      if (operation) void apply([operation], done.itemIds.length > 1 ? E.moveClips : undefined);
      return;
    }
    const item = items.get(done.itemId);
    const operation = item ? trimOperation(sequence, item, done.edge, done.frame) : null;
    if (operation) void apply([operation]);
  };

  const gestureHandlers = useRef({ move: onGestureMove, end: onGestureEnd });
  gestureHandlers.current = { move: onGestureMove, end: onGestureEnd };
  const gestureActive = gesture !== null;
  useEffect(() => {
    if (!gestureActive) return;
    const onMove = (event: PointerEvent) => {
      if (event.buttons === 0) setGesture(null);
      else gestureHandlers.current.move(event);
    };
    // 松开的位置也算一次移动：快速拖动时浏览器会合并 pointermove，最后一段可能只出现在 pointerup 里。
    const onUp = (event: PointerEvent) => {
      gestureHandlers.current.move(event);
      gestureHandlers.current.end();
    };
    const onCancel = () => setGesture(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setGesture(null);
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
  }, [gestureActive]);

  // 框选中滚动（滚轮、触控板）：指针没动，矩形的当前点跟着内容走。
  const marqueeTracking = useRef(marqueeTo);
  marqueeTracking.current = marqueeTo;
  const marqueeActive = gesture?.kind === 'marquee';
  useEffect(() => {
    const element = scrollRef.current;
    if (!marqueeActive || !element) return;
    const onScroll = () => {
      const current = gestureRef.current;
      if (current?.kind === 'marquee') marqueeTracking.current(current, current.clientX, current.clientY);
    };
    element.addEventListener('scroll', onScroll);
    return () => element.removeEventListener('scroll', onScroll);
  }, [marqueeActive]);

  // ---- 拖入：素材面板里的素材，或从电脑里拖进来的文件 ----

  const acceptsDrop = (event: DragEvent) =>
    editable && (event.dataTransfer.types.includes(ASSET_DRAG_TYPE) || event.dataTransfer.types.includes('Files'));

  const onLaneDragOver = (event: DragEvent<HTMLDivElement>, track: Track) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (dropTrack !== track.id) setDropTrack(track.id);
  };

  const onLaneDrop = (event: DragEvent<HTMLDivElement>, track: Track) => {
    setDropTrack(null);
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    const frame = Math.round(frameAtClientX(event.clientX));
    const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) {
      const asset = assets[assetId];
      if (asset && isPlaceable(asset)) void apply(placeAsset(sequence, asset, frame, track.id), E.addClip);
      return;
    }
    const files = [...event.dataTransfer.files]
      .map((file) => ({ path: runtime.host.pathForFile(file), name: file.name }))
      .filter((file) => file.path);
    if (!files.length) return;
    const kinds = files.map((file) => {
      const kind = kindOfFileName(file.name);
      return { path: file.path, kind: kind === 'video-file' ? ('video' as const) : kind === 'audio' || kind === 'image' ? kind : null };
    });
    void apply(importAndPlace(sequence, kinds, frame, track.id), E.importAndAdd);
  };

  // ---- 播放头：点刻度尺定位，按住拖动 ----

  const scrub = useRef(false);
  const onRulerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    scrub.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seek(frameAtClientX(event.clientX) / perSecond);
  };

  const steps = rulerStep(pps);
  const ticks = rulerTicks({
    minor: steps.minor,
    major: steps.major,
    from: (view.left - PAD) / pps,
    to: (view.right - PAD) / pps,
    end: (laneWidth - PAD) / pps,
  });

  const startOf = (item: SequenceItem) => itemFrames(item, fps);
  const moving = gesture?.kind === 'move' && gesture.started ? gesture : null;
  const trimming = gesture?.kind === 'trim' ? gesture : null;
  const draggingTrack = gesture?.kind === 'track' && gesture.started ? gesture : null;
  const stretching = gesture?.kind === 'stretch' ? gesture : null;
  const marquee = gesture?.kind === 'marquee' && gesture.started ? gesture : null;
  const gestureItemId = gesture && gesture.kind !== 'marquee' && gesture.kind !== 'track' ? gesture.itemId : null;

  // ---- 只画时间窗里的件 ----
  // 窗外的件不挂 DOM。不管在不在窗里都要画的：按着的那一件（移动、裁边、拉伸都对它 setPointerCapture，卸掉就丢了捕获）
  // 与右键菜单的那一件；正在拖、正在微调的几件按挪过之后的位置判断。选中的不必钉住：选中态在 store 里，滚回来重新挂上
  // 照样画成选中。片段与配音块都不接焦点（剪口带另算，见 timeline-seams.tsx）。
  const windowFrom = ((view.left - PAD) / pps) * perSecond;
  const windowTo = ((view.right - PAD) / pps) * perSecond;
  const pinned: SequenceItem[] = [];
  const pin = (id: Id | null | undefined) => {
    const item = id ? items.get(id) : undefined;
    if (item) pinned.push(item);
  };
  pin(gestureItemId);
  pin(menu?.itemId);
  const shifting = gesture?.kind === 'move' ? gesture : null;
  if (shifting || nudged) {
    const moved = new Set(shifting?.itemIds);
    const nudgedIds = new Set(nudged?.itemIds);
    for (const id of new Set([...moved, ...nudgedIds])) {
      const item = items.get(id);
      if (!item) continue;
      const delta = (moved.has(id) ? shifting!.deltaFrames : 0) + (nudgedIds.has(id) ? nudged!.deltaFrames : 0);
      const range = itemFrames(item, fps);
      if (range.end + delta >= windowFrom && range.start + delta <= windowTo) pinned.push(item);
    }
  }
  const laneItems = (track: Track) => {
    const index = lanes.get(track.id);
    return index ? spansIn(index, windowFrom, windowTo, pinned) : [];
  };

  const renderClip = (item: SequenceItem) => {
    const range = startOf(item);
    const shift = nudged && nudged.itemIds.includes(item.id) ? nudged.deltaFrames : 0;
    let start = range.start + shift;
    let end = range.end + shift;
    if (moving && moving.itemIds.includes(item.id)) {
      start += moving.deltaFrames;
      end += moving.deltaFrames;
    }
    if (trimming && trimming.itemId === item.id) {
      if (trimming.edge === 'start') start = trimming.frame;
      else end = trimming.frame;
    }
    const stretched = stretching?.itemId === item.id ? stretching.stretch : null;
    if (stretched) end = start + stretched.seconds * perSecond;
    const left = xOfFrame(start);
    const width = Math.max(2, xOfFrame(end) - left);
    const name = itemLabel(item, assets, documents);
    const track = tracks.get(item.trackId);
    const locked = item.locked || !!track?.locked;
    const selected = selection.includes(item.id);
    const active = (moving && moving.itemIds.includes(item.id)) || trimming?.itemId === item.id;
    const seconds = (end - start) / perSecond;
    const look = CLIP_LOOKS[clipKind(item)];
    const muted = item.type === 'audio' && !!item.mix.muted;
    const moved = (moving && moving.itemIds.includes(item.id) ? moving.deltaFrames : 0) + shift;
    const dub = item.type === 'audio' ? dubs.get(item.id) : undefined;
    if (dub && item.type === 'audio') {
      return (
        <DubBlockView
          key={item.id}
          dub={dub}
          name={name}
          left={left}
          width={width}
          selected={selected}
          locked={locked}
          editable={editable}
          off={!item.enabled || !!track?.muted}
          active={!!active}
          stretchSpeed={stretched ? stretched.speed : null}
          style={{
            zIndex: active || stretching?.itemId === item.id ? 6 : 1,
            transform: moving && moving.itemId === item.id && moving.offsetY ? `translateY(${moving.offsetY}px)` : undefined,
          }}
          onPointerDown={(event) => onClipPointerDown(event, item)}
          onContextMenu={(event) => onClipContextMenu(event, item)}
          onStretchPointerDown={(event) => onStretchPointerDown(event, item)}
        />
      );
    }
    const title =
      width > 36 ? (
        <span className={clipTitle}>
          <look.icon styles={clipIcon} data-bc-icons="own" />
          <span className={clipName}>{name}</span>
        </span>
      ) : null;
    return (
      <div
        key={item.id}
        className={`${clip({ hue: look.hue, isSelected: selected, isLocked: locked, isDisabled: !item.enabled || muted })} bc-clip bc-clip-item`}
        style={{
          left,
          width,
          zIndex: active ? 6 : 1,
          transform: moving && moving.itemId === item.id && moving.offsetY ? `translateY(${moving.offsetY}px)` : undefined,
        }}
        data-active={active || undefined}
        title={`${name} · ${formatTimecode(start / perSecond, fps)} – ${formatTimecode(end / perSecond, fps)}`}
        onPointerDown={(event) => onClipPointerDown(event, item)}
        onContextMenu={(event) => onClipContextMenu(event, item)}>
        {item.type === 'video' && width >= MEDIA_MIN_PX ? (
          <ClipMedia
            videoId={videoId}
            item={item}
            record={assets[item.assetRef.id]?.revisions[item.assetRef.revision]}
            clipLeft={left}
            clipWidth={width}
            clipStart={start / perSecond}
            contentStart={(range.start + moved) / perSecond}
            pxPerSecond={pps}
            scrollRef={scrollRef}
            head={HEAD}
            selected={selected}
            muted={!item.embeddedAudio.enabled || !!track?.muted}
            title={title}
          />
        ) : item.type === 'caption' ? (
          <CaptionCues
            item={item}
            sequence={sequence}
            record={documents[item.documentId]}
            clipLeft={left}
            xOf={xOf}
            scrollRef={scrollRef}
            head={HEAD}
            selected={selected}
            fallback={title}
          />
        ) : (
          <>
            {title}
            {width > 90 ? <span className={clipMeta}>{E.seconds2(seconds)}</span> : null}
          </>
        )}
        {!locked && editable && (width > 10 || trimming?.itemId === item.id) ? (
          <>
            <div className="bc-clip-handle" data-edge="start" onPointerDown={(event) => onHandlePointerDown(event, item, 'start')} />
            <div className="bc-clip-handle" data-edge="end" onPointerDown={(event) => onHandlePointerDown(event, item, 'end')} />
          </>
        ) : null}
      </div>
    );
  };

  const snapFrameAt = moving?.snap ?? trimming?.snap ?? null;
  // 拖配音块右缘时的读数：新语速与新时长，贴着右缘（设计稿 `.ttip`「1.25× · 2.40 s」）。
  const stretchReadout = (() => {
    const item = stretching?.stretch ? items.get(stretching.itemId) : undefined;
    const dub = item ? dubs.get(item.id) : undefined;
    if (!stretching?.stretch || !item || !dub) return null;
    const { rate } = stretchedLook(dub, stretching.stretch.speed);
    return {
      trackId: item.trackId,
      frame: startOf(item).start + stretching.stretch.seconds * perSecond,
      text: DUB_COPY.stretching(rate, stretching.stretch.seconds),
    };
  })();
  /**
   * 行头。字幕行写语言标签（译文换翻译图标），全名与原文 / 译文进悬停说明；配音行整条轨只放一组配音时写语言标签、全名
   * 「配音 · 语言」进悬停说明，句数、小黄点与末尾的 ⋯ 见 DubTrackHeader。
   */
  const trackHeader = (track: Track, label: string) => {
    const group = track.kind === 'audio' ? dubTrackGroup(sequence, track.id) : null;
    const tag = heads.tags.get(track.id);
    if (!group) {
      // 配音分离出的分轨：行头写「背景声 · 语言」「人声 · 语言」，同配音行。
      const stem = track.kind === 'audio' ? stemTrackOf(sequence, track.id) : null;
      const name = stem?.language ? DUB_COPY.stemTrackLabel(stem.stem, langName(stem.language)) : label;
      const kind = heads.kinds.get(track.id);
      return (
        <TrackHeader
          track={track}
          label={name}
          tag={tag}
          icon={kind === 'translation' ? Translate : undefined}
          hint={kind ? `${name} · ${captionKindLabel(kind)}` : name}
          flag={false}
          editable={editable}
          sequenceId={sequence.id}
          draggable={canDragTrack(track)}
          onDragStart={(event) => onHeaderPointerDown(event, track)}
        />
      );
    }
    const name = group.language ? DUB_COPY.trackLabel(langName(group.language)) : label;
    return (
      <DubTrackHeader
        track={track}
        group={group}
        name={name}
        tag={tag}
        sequence={sequence}
        documents={documents}
        blocks={dubs}
        editable={editable}
        draggable={canDragTrack(track)}
        onDragStart={(event) => onHeaderPointerDown(event, track)}
      />
    );
  };
  const readoutFrame = moving
    ? (() => {
        const grabbed = items.get(moving.itemId);
        return grabbed ? startOf(grabbed).start + moving.deltaFrames : null;
      })()
    : trimming
      ? trimming.frame
      : null;

  return (
    <div className={root} style={{ height }} aria-label={E.timeline}>
      <TimelineChapters sequence={sequence} />
      <div ref={scrollRef} className={`${scroller} bc-scroll`} onPointerDown={onBlankPointerDown}>
        <div style={{ position: 'relative', width: HEAD + laneWidth, minHeight: '100%', userSelect: marquee || gesture?.kind === 'track' ? 'none' : undefined }}>
          <div className={rulerRow}>
            <div className={corner} />
            <div
              className={rulerLane}
              style={{ width: laneWidth }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onRulerPointerDown(event);
              }}
              onPointerMove={(event) => {
                if (scrub.current && event.buttons === 0) scrub.current = false;
                if (scrub.current) seek(frameAtClientX(event.clientX) / perSecond);
              }}
              onPointerUp={() => {
                scrub.current = false;
              }}
              onLostPointerCapture={() => {
                scrub.current = false;
              }}>
              {ticks.map((t) => (
                <span key={t.seconds}>
                  <span className={tick} style={{ left: xOf(t.seconds), height: t.major ? 10 : 5 }} />
                  {t.major ? (
                    <span className={tickLabel} style={{ left: xOf(t.seconds) }}>
                      {rulerLabel(t.seconds, steps.major)}
                    </span>
                  ) : null}
                </span>
              ))}
              <PlayheadFlag pps={pps} />
            </div>
          </div>

          {liveRows.map((jobId) => (
            <LiveCaptionRow
              key={jobId}
              jobId={jobId}
              sequence={sequence}
              assets={assets}
              height={ROW_HEIGHT}
              rowClass={row}
              headerClass={header({ isOff: false })}
              laneClass={lane({ isDropTarget: false })}
              laneWidth={laneWidth}
              pps={pps}
              xOf={xOf}
              view={view}
              onSeek={seek}
            />
          ))}
          {transcripts.map((source) => (
            <TranscriptRow
              key={source.assetId}
              source={source}
              sequence={sequence}
              height={ROW_HEIGHT}
              rowClass={row}
              headerClass={header({ isOff: false })}
              laneClass={lane({ isDropTarget: false })}
              laneWidth={laneWidth}
              xOf={xOf}
              view={view}
              onSeek={seek}
            />
          ))}
          {rows.map(({ track, label }) => (
            <div
              key={track.id}
              className={row}
              style={{
                height: rowHeight(track),
                // 拖行头时这一行跟着指针走（不换父节点，指针捕获不断），压在别的行上面。
                transform: draggingTrack?.trackId === track.id ? `translateY(${draggingTrack.offsetY}px)` : undefined,
                zIndex: draggingTrack?.trackId === track.id ? 6 : undefined,
                opacity: draggingTrack?.trackId === track.id ? 0.85 : undefined,
              }}>
              {draggingTrack?.target?.trackId === track.id ? (
                <div className={trackDropLine} style={draggingTrack.target.position === 'above' ? { top: -1 } : { bottom: -1 }} />
              ) : null}
              {trackHeader(track, label)}
              <div
                ref={(element) => {
                  if (element) laneRefs.current.set(track.id, element);
                  else laneRefs.current.delete(track.id);
                }}
                className={lane({
                  isDropTarget:
                    dropTrack === track.id || (moving?.trackId === track.id && moving.trackId !== items.get(moving.itemId)?.trackId),
                })}
                style={{ width: laneWidth }}
                onDragOver={(event) => onLaneDragOver(event, track)}
                onDragLeave={() => setDropTrack(null)}
                onDrop={(event) => onLaneDrop(event, track)}>
                {moving
                  ? moving.itemIds
                      .map((id) => items.get(id))
                      .filter((item): item is SequenceItem => !!item && item.trackId === track.id)
                      .map((item) => {
                        const range = startOf(item);
                        if (range.end < windowFrom || range.start > windowTo) return null;
                        return (
                          <div
                            key={`ghost-${item.id}`}
                            className={ghost}
                            style={{ left: xOfFrame(range.start), width: xOfFrame(range.end) - xOfFrame(range.start) }}
                          />
                        );
                      })
                  : null}
                {laneItems(track).map(renderClip)}
                {readoutFrame !== null && gestureItemId && items.get(gestureItemId)?.trackId === track.id ? (
                  <span className={readout} style={{ left: xOfFrame(readoutFrame) }}>
                    {formatTimecode(readoutFrame / perSecond, fps)}
                  </span>
                ) : null}
                {stretchReadout?.trackId === track.id ? (
                  <span className={readout} style={{ left: xOfFrame(stretchReadout.frame), transform: 'translateX(-100%)' }}>
                    {stretchReadout.text}
                  </span>
                ) : null}
              </div>
            </div>
          ))}

          {/* 剪口带贯穿所有轨道（原型 timeline-cutbands.jsx）；拖片段、微调时先收起，框选时留着。 */}
          {(gesture && gesture.kind !== 'marquee') || nudged ? null : (
            <CutBands
              sequence={sequence}
              assets={assets}
              documents={documents}
              xOfFrame={(frame) => HEAD + xOfFrame(frame)}
              top={RULER}
              height={rows.reduce((sum, { track }) => sum + rowHeight(track), (liveRows.length + transcripts.length) * ROW_HEIGHT)}
              pps={pps}
              frames={{ from: windowFrom, to: windowTo }}
              editable={editable}
            />
          )}

          {sequence.items.length === 0 && rows.length ? (
            <div className={emptyBox} style={{ top: RULER + 8, left: HEAD + PAD, height: rowHeight(rows[0]!.track) - 16 }}>
              {E.emptyTimeline}
            </div>
          ) : null}

          {snapFrameAt !== null ? <div className="bc-snapline" style={{ left: HEAD + xOfFrame(snapFrameAt) }} /> : null}
          {marquee ? (
            // 压在片段（z 1–6）之上、不接指针；矩形本身与舞台的框选同一个样子。
            <div style={{ position: 'absolute', left: 0, top: 0, zIndex: 7, pointerEvents: 'none' }}>
              <Marquee rect={marqueeRect(marquee)} />
            </div>
          ) : null}
          <Playhead pps={pps} scroller={scrollRef} />
        </div>
      </div>
      <TimelineMenu target={menu} sequence={sequence} assets={assets} documents={documents} dubBlocks={dubs} onClose={() => setMenu(null)} />
    </div>
  );
}

/** 播放头单独订阅：播放时每帧只重画这一条线，竖贯整个轨道区（轨道少时也到底）。播放中跑出可见范围时，视图跟着翻页。 */
function Playhead({ pps, scroller }: { pps: number; scroller: { current: HTMLDivElement | null } }) {
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const left = HEAD + playheadX(playhead, pps);
  useEffect(() => {
    const element = scroller.current;
    if (!element || !playing) return;
    const x = left - HEAD;
    const visible = element.clientWidth - HEAD;
    // 右边留 PAD：「适应窗口」时片尾正好落在 visible - PAD，播到片尾也不翻页。
    if (x < element.scrollLeft || x > element.scrollLeft + visible - PAD) scrollLaneTo(element, Math.max(0, Math.round(x - visible / 4)));
  }, [left, playing, scroller]);
  return <div className="bc-playhead" style={{ left }} aria-hidden />;
}

/** 刻度尺上的播放头小旗：放在已经吸顶的刻度尺里，竖向滚动时留在上沿；与竖线同一个 `playheadX`，同样单独订阅，播放时只重画它。 */
function PlayheadFlag({ pps }: { pps: number }) {
  const playhead = useEditor((s) => s.playhead);
  return <span className="bc-playhead-flag" style={{ left: playheadX(playhead, pps) }} aria-hidden />;
}

/**
 * 播放头在泳道里的横坐标，取整到设备像素：竖线的边框按整像素画，小旗的斜边按亚像素抗锯齿，
 * 不取整时两者各自舍入，移动中相差在 ±1px 间来回跳；取整后两者相对位置恒定。HEAD 是整数，竖线加上它不影响取整。
 */
function playheadX(seconds: number, pps: number) {
  const dpr = window.devicePixelRatio || 1;
  return Math.round((PAD + seconds * pps) * dpr) / dpr;
}

/**
 * 配音行的行头：名字的提示写这条轨的句数（没合成、过快、静音、重生成中），有句过快或没合成时亮小黄点；末尾一个 ⋯
 * （timeline-dub-head.tsx）。计数与 ⋯ 的头部同一份（设计稿两处都是 `trackLine`）。
 */
function DubTrackHeader({
  track,
  group,
  name,
  tag,
  sequence,
  documents,
  blocks,
  editable,
  draggable,
  onDragStart,
}: {
  track: Track;
  group: DubGroup;
  name: string;
  /** 语言标签（EN、ZH），没有语言时不给、行头写全名。 */
  tag?: string;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  blocks: ReadonlyMap<Id, DubBlock>;
  editable: boolean;
  draggable: boolean;
  onDragStart(event: ReactPointerEvent<HTMLDivElement>): void;
}) {
  const { counts } = useDubTrack(group, sequence, documents, blocks);
  return (
    <TrackHeader
      track={track}
      label={name}
      tag={tag}
      hint={`${name} · ${DUB_REGEN_COPY.headLine(counts)}`}
      flag={counts.fast > 0 || counts.failed > 0}
      menu={<DubHeadMenu group={group} label={name} sequence={sequence} documents={documents} blocks={blocks} />}
      editable={editable}
      sequenceId={sequence.id}
      draggable={draggable}
      onDragStart={onDragStart}
    />
  );
}

function TrackHeader({
  track,
  label,
  tag,
  icon,
  hint,
  flag,
  menu,
  editable,
  sequenceId,
  draggable,
  onDragStart,
}: {
  track: Track;
  /** 全名：没有标签时写在行头上，开关的读屏名也用它。 */
  label: string;
  /** 语言标签（字幕行、配音行）：给了就写它，不写全名。 */
  tag?: string;
  /** 换掉按类别的图标（译文字幕行是翻译图标）。 */
  icon?: typeof Video;
  /** 悬停在名字上的说明（配音行写句数、过快与静音）。 */
  hint: string;
  /** 配音行有句过快：名字后面一个小黄点。 */
  flag: boolean;
  /** 配音行末尾的 ⋯。 */
  menu?: ReactNode;
  editable: boolean;
  sequenceId: Id;
  /** 同一叠的行不止一条时可以拖着换顺序。 */
  draggable: boolean;
  onDragStart(event: ReactPointerEvent<HTMLDivElement>): void;
}) {
  const { apply } = useEditorActions();
  const update = (patch: { visible?: boolean; muted?: boolean; locked?: boolean }, what: string) =>
    void apply([{ type: 'updateTrack', sequenceId, trackId: track.id, ...patch }], what);
  const off = track.kind === 'audio' ? track.muted : !track.visible;
  const Icon = icon ?? TRACK_ICON[track.kind];
  return (
    <div
      className={header({ isOff: off, isDraggable: draggable })}
      onPointerDown={(event) => {
        event.stopPropagation();
        onDragStart(event);
      }}>
      <Icon styles={clipIcon} data-bc-icons="own" />
      {tag ? (
        <span className={headerTag} title={hint}>
          {tag}
        </span>
      ) : (
        <span className={headerLabel} title={hint}>
          {label}
        </span>
      )}
      {flag ? <span className={headerFlag} title={hint} /> : null}
      <span className={headerToggles}>
        {track.kind !== 'audio' ? (
          <HeaderToggle
            label={track.visible ? E.hideTrack(label) : E.showTrack(label)}
            isDisabled={!editable}
            onPress={() => update({ visible: !track.visible }, track.visible ? E.hideTrackLabel : E.showTrackLabel)}>
            {track.visible ? <Visibility /> : <VisibilityOff />}
          </HeaderToggle>
        ) : null}
        {track.kind !== 'subtitle' ? (
          <HeaderToggle
            label={track.muted ? E.unmuteTrack(label) : E.muteTrack(label)}
            isDisabled={!editable}
            onPress={() => update({ muted: !track.muted }, track.muted ? E.unmuteTrackLabel : E.muteTrackLabel)}>
            {track.muted ? <VolumeOff /> : <VolumeTwo />}
          </HeaderToggle>
        ) : null}
        <HeaderToggle
          label={track.locked ? E.unlockTrack(label) : E.lockTrack(label)}
          isDisabled={!editable}
          onPress={() => update({ locked: !track.locked }, track.locked ? E.unlockTrackLabel : E.lockTrackLabel)}>
          {track.locked ? <Lock /> : <LockOpen />}
        </HeaderToggle>
        {menu}
      </span>
    </div>
  );
}

function HeaderToggle({
  label,
  isDisabled,
  onPress,
  children,
}: {
  label: string;
  isDisabled: boolean;
  onPress(): void;
  children: ReactNode;
}) {
  return (
    <TooltipTrigger>
      <ActionButton isQuiet size="XS" aria-label={label} isDisabled={isDisabled} onPress={onPress}>
        {children}
      </ActionButton>
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}
