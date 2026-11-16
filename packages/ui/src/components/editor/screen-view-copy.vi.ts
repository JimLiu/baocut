import type { ScreenViewMessages } from './screen-view-copy.ts';

export const vi: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "Khung hình màn hình",
  zooms: "Phóng to",
  zoomsEmpty: "Chưa có đoạn phóng to. Kéo trên hàng Phóng to của dòng thời gian để thêm.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "Tự động",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "Tự động, đã sửa",
  zoomManual: "Thủ công",
  /** 倍率 */
  amount: "Mức",
  focus: "Nhìn vào",
  focusPointer: "Theo chuột",
  focusPoint: "Điểm cố định",
  focusPointNote: "Kéo khung trên sân khấu để chọn chỗ nhìn.",
  focusFrame: "Vùng phóng to",
  rampIn: "Chuyển vào",
  rampOut: "Chuyển ra",
  deleteZoom: "Xóa đoạn phóng to",
  follow: "Bám theo",
  safeArea: "Vùng an toàn",
  smoothing: "Làm mượt",
  regenerate: "Tạo lại",
  regenerateTip: "Tạo lại các đoạn phóng to tự động từ các cú nhấp. Đoạn bạn đã sửa hoặc thêm vẫn giữ.",
  cursor: "Con trỏ",
  cursorSize: "Kích thước",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "Ẩn khi đứng yên",
  clickRipple: "Làm nổi cú nhấp",
  cursorBaked: "Con trỏ đã được ghi vào hình nên không thể ẩn, phóng to hay đổi kiểu.",
  cursorNone: "Bản ghi này không có con trỏ.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "Phóng to",
  mouseRow: "Chuột",
  zoomRowTip: "Kéo ở chỗ trống để thêm phóng to; kéo đoạn hoặc hai đầu để sửa",
  mouseRowTip: "Các cú nhấp trong bản ghi. Nhấp vào hàng để chỉnh con trỏ.",
  /** 鼠标行上一次点击的读屏名 */
  click: "Cú nhấp",
  /** 片段上的联动标记的提示 */
  linked: "Liên kết với các track khác của bản ghi: di chuyển, tách và cắt cùng lúc",
  ungroup: "Rã nhóm",
  ungroupTip: "Sửa riêng màn hình, camera và âm thanh",
  cameraLayout: "Bố cục camera",
  layoutCornerCircle: "Tròn ở góc",
  layoutCornerRounded: "Bo góc ở góc",
  layoutSplit: "Song song",
  layoutCameraFull: "Chỉ camera",
  layoutHidden: "Ẩn",
  /** 当前布局对不上任何预设 */
  layoutCustom: "Tùy chỉnh",
  cameraLayoutNote: "Muốn đổi một đoạn thôi, hãy tách bản ghi ở hai đầu đoạn đó trước.",
  presentation: "Kiểu trình bày",
  presentationFull: "Toàn màn hình",
  presentationInset: "Thu nhỏ có viền",
  presentationNote: "Phần viền hiện màu nền của khung vẽ.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "Khung phóng to",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `Phóng to ${n}`,
};
