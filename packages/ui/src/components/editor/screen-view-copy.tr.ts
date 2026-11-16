import type { ScreenViewMessages } from './screen-view-copy.ts';

export const tr: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "Ekran çerçeveleme",
  zooms: "Yakınlaştırmalar",
  zoomsEmpty: "Henüz yakınlaştırma yok. Eklemek için zaman çizelgesindeki Yakınlaştırma satırında sürükleyin.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "Otomatik",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "Otomatik, düzenlendi",
  zoomManual: "Elle",
  /** 倍率 */
  amount: "Oran",
  focus: "Odak",
  focusPointer: "Fareyi izle",
  focusPoint: "Sabit nokta",
  focusPointNote: "Nereye bakılacağını seçmek için sahnedeki çerçeveyi sürükleyin.",
  rampIn: "Giriş geçişi",
  rampOut: "Çıkış geçişi",
  deleteZoom: "Yakınlaştırmayı sil",
  follow: "Takip",
  safeArea: "Güvenli alan",
  smoothing: "Yumuşatma",
  regenerate: "Yeniden oluştur",
  regenerateTip: "Otomatik yakınlaştırmaları tıklamalardan yeniden oluşturur. Değiştirdikleriniz ve eklediklerinizde kalır.",
  cursor: "İmleç",
  cursorSize: "Boyut",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "Hareketsizken gizle",
  clickRipple: "Tıklamaları vurgula",
  cursorBaked: "İmleç görüntüye kaydedildi; gizlenemez, büyütülemez veya değiştirilemez.",
  cursorNone: "Bu kayıtta imleç yok.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "Yakınlaştırma",
  mouseRow: "Fare",
  zoomRowTip: "Eklemek için boş yerde sürükleyin; değiştirmek için yakınlaştırmayı veya kenarlarını sürükleyin",
  mouseRowTip: "Bu kayıttaki tıklamalar. İmleci ayarlamak için satıra tıklayın.",
  /** 鼠标行上一次点击的读屏名 */
  click: "Tıklama",
  /** 片段上的联动标记的提示 */
  linked: "Bu kaydın diğer parçalarıyla bağlı: taşıma, bölme ve kırpma birlikte yapılır",
  ungroup: "Grubu çöz",
  ungroupTip: "Bu kaydın ekranını, kamerasını ve sesini ayrı ayrı düzenleyin",
  cameraLayout: "Kamera yerleşimi",
  layoutCornerCircle: "Köşede daire",
  layoutCornerRounded: "Köşede yuvarlak",
  layoutSplit: "Yan yana",
  layoutCameraFull: "Yalnız kamera",
  layoutHidden: "Gizli",
  /** 当前布局对不上任何预设 */
  layoutCustom: "Özel",
  cameraLayoutNote: "Yalnızca bir bölümü değiştirmek için önce kaydı o bölümün iki ucundan bölün.",
  presentation: "Sunum",
  presentationFull: "Tam ekran",
  presentationInset: "Kenar boşluklu",
  presentationNote: "Kenar boşluğunda tuvalin arka plan rengi görünür.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "Yakınlaştırma çerçevesi",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `Yakınlaştırma ${n}`,
};
