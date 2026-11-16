import { defineMessages } from '@baocut/protocol';
import { zhHans } from './screen-view-copy.zh-Hans.ts';
import { zhHant } from './screen-view-copy.zh-Hant.ts';
import { ja } from './screen-view-copy.ja.ts';
import { ko } from './screen-view-copy.ko.ts';
import { es } from './screen-view-copy.es.ts';
import { fr } from './screen-view-copy.fr.ts';
import { de } from './screen-view-copy.de.ts';
import { nl } from './screen-view-copy.nl.ts';
import { ptBR } from './screen-view-copy.pt-BR.ts';
import { it } from './screen-view-copy.it.ts';
import { ru } from './screen-view-copy.ru.ts';
import { pl } from './screen-view-copy.pl.ts';
import { tr } from './screen-view-copy.tr.ts';
import { vi } from './screen-view-copy.vi.ts';

/** 编辑录制的文案（屏幕录制设计 §5）：检查器「屏幕取景」一节、缩放与鼠标附属行、联动组、摄像头布局与演示样式。 */
const en = {
  /** 检查器一节的标题 */
  section: "Screen framing",
  zooms: "Zooms",
  zoomsEmpty: "No zooms yet. Drag on the Zoom row in the timeline to add one.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "Auto",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "Auto, edited",
  zoomManual: "Manual",
  /** 倍率 */
  amount: "Amount",
  focus: "Look at",
  focusPointer: "Follow mouse",
  focusPoint: "Fixed point",
  focusPointNote: "Drag the frame on the stage to choose where to look.",
  /** 舞台上取景框的读屏名 */
  focusFrame: "Zoomed area",
  rampIn: "Ease in",
  rampOut: "Ease out",
  deleteZoom: "Delete zoom",
  follow: "Follow",
  safeArea: "Safe area",
  smoothing: "Smoothing",
  regenerate: "Regenerate",
  regenerateTip: "Recreate the auto zooms from the clicks. Zooms you changed or added stay.",
  cursor: "Cursor",
  cursorSize: "Size",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "Hide when still",
  clickRipple: "Highlight clicks",
  cursorBaked: "The cursor was recorded into the picture, so it can’t be hidden, resized or restyled.",
  cursorNone: "This recording has no cursor.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "Zoom",
  mouseRow: "Mouse",
  zoomRowTip: "Drag on an empty part to add a zoom; drag a zoom or its edges to change it",
  mouseRowTip: "Clicks in this recording. Click the row to style the cursor.",
  /** 鼠标行上一次点击的读屏名 */
  click: "Click",
  /** 片段上的联动标记的提示 */
  linked: "Linked with the other tracks of this recording: moving, splitting and trimming affect them together",
  ungroup: "Ungroup",
  ungroupTip: "Edit screen, camera and sound separately",
  cameraLayout: "Camera layout",
  layoutCornerCircle: "Circle, corner",
  layoutCornerRounded: "Rounded, corner",
  layoutSplit: "Side by side",
  layoutCameraFull: "Camera only",
  layoutHidden: "Hidden",
  /** 当前布局对不上任何预设 */
  layoutCustom: "Custom",
  cameraLayoutNote: "To change the layout for one part only, split the recording at both ends of that part first.",
  presentation: "Presentation",
  presentationFull: "Full screen",
  presentationInset: "Inset",
  presentationNote: "The margin shows the canvas background color.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "Zoom framing",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `Zoom ${n}`,
};

export type ScreenViewMessages = typeof en;

export const SCREEN_VIEW_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
