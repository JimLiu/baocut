import type { ScreenViewMessages } from './screen-view-copy.ts';

export const ko: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "화면 프레이밍",
  zooms: "확대",
  zoomsEmpty: "아직 확대가 없습니다. 타임라인의 확대 행에서 드래그해 추가하세요.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "자동",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "자동 · 수정됨",
  zoomManual: "수동",
  /** 倍率 */
  amount: "배율",
  focus: "보는 곳",
  focusPointer: "마우스 따라가기",
  focusPoint: "고정 지점",
  focusPointNote: "스테이지의 틀을 드래그해 볼 곳을 고르세요.",
  focusFrame: "확대 영역",
  rampIn: "들어가기 전환",
  rampOut: "나가기 전환",
  deleteZoom: "이 확대 삭제",
  follow: "따라가기",
  safeArea: "안전 영역",
  smoothing: "부드럽게",
  regenerate: "다시 만들기",
  regenerateTip: "클릭에서 자동 확대를 다시 만듭니다. 고치거나 추가한 확대는 남습니다.",
  cursor: "커서",
  cursorSize: "크기",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "멈추면 숨기기",
  clickRipple: "클릭 강조",
  cursorBaked: "커서가 화면에 함께 녹화되어 숨기거나 크기·모양을 바꿀 수 없습니다.",
  cursorNone: "이 녹화에는 커서가 없습니다.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "확대",
  mouseRow: "마우스",
  zoomRowTip: "빈 곳을 드래그해 확대 추가, 확대나 양끝을 드래그해 변경",
  mouseRowTip: "이 녹화의 클릭입니다. 행을 클릭해 커서를 꾸미세요.",
  /** 鼠标行上一次点击的读屏名 */
  click: "클릭",
  /** 片段上的联动标记的提示 */
  linked: "이 녹화의 다른 트랙과 연동: 이동·분할·자르기가 함께 적용됩니다",
  ungroup: "그룹 해제",
  ungroupTip: "화면·카메라·소리를 따로 편집",
  cameraLayout: "카메라 배치",
  layoutCornerCircle: "원형 · 오른쪽 아래",
  layoutCornerRounded: "둥근 사각형 · 왼쪽 아래",
  layoutSplit: "좌우 분할",
  layoutCameraFull: "카메라만",
  layoutHidden: "숨김",
  /** 当前布局对不上任何预设 */
  layoutCustom: "사용자 지정",
  cameraLayoutNote: "일부 구간만 바꾸려면 먼저 그 구간 양끝에서 녹화를 분할하세요.",
  presentation: "표시 방식",
  presentationFull: "전체 화면",
  presentationInset: "여백 두기",
  presentationNote: "여백에는 캔버스 배경색이 보입니다.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "확대 틀",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `확대 ${n}`,
};
