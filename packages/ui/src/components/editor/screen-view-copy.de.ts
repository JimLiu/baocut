import type { ScreenViewMessages } from './screen-view-copy.ts';

export const de: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "Bildausschnitt",
  zooms: "Zooms",
  zoomsEmpty: "Noch keine Zooms. Zieh in der Zeile „Zoom“ der Zeitleiste, um einen hinzuzufügen.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "Automatisch",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "Automatisch, bearbeitet",
  zoomManual: "Manuell",
  /** 倍率 */
  amount: "Stärke",
  focus: "Fokus",
  focusPointer: "Maus folgen",
  focusPoint: "Fester Punkt",
  focusPointNote: "Zieh den Rahmen auf der Bühne, um den Fokus zu wählen.",
  rampIn: "Einblenden",
  rampOut: "Ausblenden",
  deleteZoom: "Zoom löschen",
  follow: "Folgen",
  safeArea: "Sicherer Bereich",
  smoothing: "Glättung",
  regenerate: "Neu erzeugen",
  regenerateTip: "Erzeugt die automatischen Zooms aus den Klicks neu. Geänderte oder hinzugefügte bleiben.",
  cursor: "Mauszeiger",
  cursorSize: "Größe",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "Bei Stillstand ausblenden",
  clickRipple: "Klicks hervorheben",
  cursorBaked: "Der Mauszeiger ist ins Bild aufgenommen und lässt sich nicht ausblenden, vergrößern oder ändern.",
  cursorNone: "Diese Aufnahme hat keinen Mauszeiger.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "Zoom",
  mouseRow: "Maus",
  zoomRowTip: "Auf leerer Stelle ziehen fügt einen Zoom hinzu; Zoom oder Ränder ziehen ändert ihn",
  mouseRowTip: "Klicks dieser Aufnahme. Klick auf die Zeile, um den Mauszeiger einzustellen.",
  /** 鼠标行上一次点击的读屏名 */
  click: "Klick",
  /** 片段上的联动标记的提示 */
  linked: "Mit den anderen Spuren dieser Aufnahme verknüpft: Verschieben, Teilen und Trimmen wirken gemeinsam",
  ungroup: "Gruppierung aufheben",
  ungroupTip: "Bildschirm, Kamera und Ton dieser Aufnahme getrennt bearbeiten",
  cameraLayout: "Kamera-Layout",
  layoutCornerCircle: "Kreis in der Ecke",
  layoutCornerRounded: "Abgerundet in der Ecke",
  layoutSplit: "Nebeneinander",
  layoutCameraFull: "Nur Kamera",
  layoutHidden: "Ausgeblendet",
  /** 当前布局对不上任何预设 */
  layoutCustom: "Benutzerdefiniert",
  cameraLayoutNote: "Um nur einen Teil zu ändern, teile die Aufnahme zuerst an beiden Enden dieses Teils.",
  presentation: "Darstellung",
  presentationFull: "Vollbild",
  presentationInset: "Mit Rand",
  presentationNote: "Im Rand ist die Hintergrundfarbe der Leinwand zu sehen.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "Zoom-Rahmen",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `Zoom ${n}`,
};
