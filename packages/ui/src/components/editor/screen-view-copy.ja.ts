import type { ScreenViewMessages } from './screen-view-copy.ts';

export const ja: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "画面フレーミング",
  zooms: "ズーム",
  zoomsEmpty: "ズームはまだありません。タイムラインの「ズーム」行をドラッグして追加します。",
  /** 自动生成、没改过的区间 */
  zoomAuto: "自動",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "自動・編集済み",
  zoomManual: "手動",
  /** 倍率 */
  amount: "倍率",
  focus: "注視点",
  focusPointer: "マウスに追従",
  focusPoint: "固定点",
  focusPointNote: "ステージ上の枠をドラッグして注視点を選びます。",
  focusFrame: "ズーム範囲",
  rampIn: "イン",
  rampOut: "アウト",
  deleteZoom: "このズームを削除",
  follow: "追従",
  safeArea: "セーフエリア",
  smoothing: "スムージング",
  regenerate: "再生成",
  regenerateTip: "クリックから自動ズームを作り直します。編集・追加したズームは残ります。",
  cursor: "カーソル",
  cursorSize: "サイズ",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "静止時に隠す",
  clickRipple: "クリックを強調",
  cursorBaked: "カーソルが映像に録り込まれているため、隠す・拡大・変更はできません。",
  cursorNone: "この録画にはカーソルがありません。",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "ズーム",
  mouseRow: "マウス",
  zoomRowTip: "空いた所をドラッグでズームを追加、ズームや端をドラッグで変更",
  mouseRowTip: "この録画のクリック。行をクリックしてカーソルを設定します。",
  /** 鼠标行上一次点击的读屏名 */
  click: "クリック",
  /** 片段上的联动标记的提示 */
  linked: "この録画の他のトラックと連動：移動・分割・トリムは一緒に行われます",
  ungroup: "グループ解除",
  ungroupTip: "画面・カメラ・音声を別々に編集",
  cameraLayout: "カメラの配置",
  layoutCornerCircle: "円・右下",
  layoutCornerRounded: "角丸・左下",
  layoutSplit: "左右に分割",
  layoutCameraFull: "カメラのみ",
  layoutHidden: "非表示",
  /** 当前布局对不上任何预设 */
  layoutCustom: "カスタム",
  cameraLayoutNote: "一部分だけ変えるには、先にその範囲の両端で録画を分割します。",
  presentation: "見せ方",
  presentationFull: "全画面",
  presentationInset: "余白あり",
  presentationNote: "余白にはキャンバスの背景色が見えます。",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "ズームの枠",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `ズーム ${n}`,
};
