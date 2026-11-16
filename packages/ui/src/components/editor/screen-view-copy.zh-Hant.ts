import type { ScreenViewMessages } from './screen-view-copy.ts';

export const zhHant: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "螢幕取景",
  zooms: "縮放",
  zoomsEmpty: "還沒有縮放。在時間軸的「縮放」列上拖出一段來加。",
  /** 自动生成、没改过的区间 */
  zoomAuto: "自動",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "自動 · 改過",
  zoomManual: "手動",
  /** 倍率 */
  amount: "倍率",
  focus: "看哪裡",
  focusPointer: "跟隨滑鼠",
  focusPoint: "固定一點",
  focusPointNote: "在舞台上拖動取景框，選看哪裡。",
  rampIn: "進入過渡",
  rampOut: "退出過渡",
  deleteZoom: "刪除這段縮放",
  follow: "跟隨",
  safeArea: "安全區",
  smoothing: "平滑",
  regenerate: "重新產生",
  regenerateTip: "依點擊重新產生自動縮放；改過的和手動加的留著。",
  cursor: "游標",
  cursorSize: "大小",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "靜止後隱去",
  clickRipple: "點擊提示",
  cursorBaked: "游標錄進了畫面裡，不能隱藏、放大或換樣式。",
  cursorNone: "這次錄製沒有游標。",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "縮放",
  mouseRow: "滑鼠",
  zoomRowTip: "空白處拖出一段加縮放；拖動一段或它的兩端來改",
  mouseRowTip: "這次錄製裡的點擊。點這一列改游標樣式。",
  /** 鼠标行上一次点击的读屏名 */
  click: "點擊",
  /** 片段上的联动标记的提示 */
  linked: "與這次錄製的其他軌道連動：移動、分割、修剪一起進行",
  ungroup: "解除群組",
  ungroupTip: "螢幕、鏡頭與聲音各剪各的",
  cameraLayout: "鏡頭版面",
  layoutCornerCircle: "圓形 · 右下角",
  layoutCornerRounded: "圓角矩形 · 左下角",
  layoutSplit: "左右分割",
  layoutCameraFull: "鏡頭全螢幕",
  layoutHidden: "隱藏",
  /** 当前布局对不上任何预设 */
  layoutCustom: "自訂",
  cameraLayoutNote: "只想改某一段：先在那一段的兩端分割整組。",
  presentation: "簡報樣式",
  presentationFull: "全螢幕",
  presentationInset: "縮小留邊",
  presentationNote: "留邊露出畫布底色。",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "縮放取景框",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `縮放 ${n}`,
};
