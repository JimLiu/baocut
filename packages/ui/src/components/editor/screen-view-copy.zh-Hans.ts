import type { ScreenViewMessages } from './screen-view-copy.ts';

export const zhHans: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "屏幕取景",
  zooms: "缩放",
  zoomsEmpty: "还没有缩放。在时间线的「缩放」行上拖出一段来加。",
  /** 自动生成、没改过的区间 */
  zoomAuto: "自动",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "自动 · 改过",
  zoomManual: "手动",
  /** 倍率 */
  amount: "倍率",
  focus: "看哪里",
  focusPointer: "跟随鼠标",
  focusPoint: "固定一点",
  focusPointNote: "在舞台上拖动取景框，选看哪里。",
  focusFrame: "取景框",
  rampIn: "进入过渡",
  rampOut: "退出过渡",
  deleteZoom: "删除这段缩放",
  follow: "跟随",
  safeArea: "安全区",
  smoothing: "平滑",
  regenerate: "重新生成",
  regenerateTip: "按点击重新生成自动缩放；改过的和手动加的留着。",
  cursor: "光标",
  cursorSize: "大小",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "静止后隐去",
  clickRipple: "点击提示",
  cursorBaked: "光标录进了画面里，不能隐藏、放大或换样式。",
  cursorNone: "这次录制没有光标。",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "缩放",
  mouseRow: "鼠标",
  zoomRowTip: "空白处拖出一段加缩放；拖动一段或它的两端来改",
  mouseRowTip: "这次录制里的点击。点这一行改光标样式。",
  /** 鼠标行上一次点击的读屏名 */
  click: "点击",
  /** 片段上的联动标记的提示 */
  linked: "与这次录制的其他轨道联动：移动、拆分、修剪一起进行",
  ungroup: "解组",
  ungroupTip: "屏幕、摄像头与声音各剪各的",
  cameraLayout: "摄像头布局",
  layoutCornerCircle: "圆形 · 右下角",
  layoutCornerRounded: "圆角矩形 · 左下角",
  layoutSplit: "左右分屏",
  layoutCameraFull: "摄像头全屏",
  layoutHidden: "隐藏",
  /** 当前布局对不上任何预设 */
  layoutCustom: "自定义",
  cameraLayoutNote: "只想改某一段：先在那一段的两端拆分整组。",
  presentation: "演示样式",
  presentationFull: "全屏",
  presentationInset: "缩小留边",
  presentationNote: "留边露出画布底色。",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "缩放取景框",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `缩放 ${n}`,
};
