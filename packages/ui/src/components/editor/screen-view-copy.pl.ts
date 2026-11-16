import type { ScreenViewMessages } from './screen-view-copy.ts';

export const pl: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "Kadrowanie ekranu",
  zooms: "Powiększenia",
  zoomsEmpty: "Brak powiększeń. Przeciągnij w wierszu Powiększenie na osi czasu, aby dodać.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "Automatyczne",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "Automatyczne, edytowane",
  zoomManual: "Ręczne",
  /** 倍率 */
  amount: "Krotność",
  focus: "Cel",
  focusPointer: "Za myszą",
  focusPoint: "Stały punkt",
  focusPointNote: "Przeciągnij ramkę na scenie, aby wybrać cel.",
  rampIn: "Przejście wejścia",
  rampOut: "Przejście wyjścia",
  deleteZoom: "Usuń powiększenie",
  follow: "Podążanie",
  safeArea: "Strefa bezpieczna",
  smoothing: "Wygładzanie",
  regenerate: "Wygeneruj ponownie",
  regenerateTip: "Tworzy automatyczne powiększenia od nowa na podstawie kliknięć. Zmienione i dodane zostają.",
  cursor: "Kursor",
  cursorSize: "Rozmiar",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "Ukryj w bezruchu",
  clickRipple: "Wyróżniaj kliknięcia",
  cursorBaked: "Kursor nagrał się w obrazie, więc nie można go ukryć, powiększyć ani zmienić.",
  cursorNone: "To nagranie nie ma kursora.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "Powiększenie",
  mouseRow: "Mysz",
  zoomRowTip: "Przeciągnij w pustym miejscu, aby dodać powiększenie; przeciągnij je lub krawędzie, aby zmienić",
  mouseRowTip: "Kliknięcia w tym nagraniu. Kliknij wiersz, aby ustawić kursor.",
  /** 鼠标行上一次点击的读屏名 */
  click: "Kliknięcie",
  /** 片段上的联动标记的提示 */
  linked: "Połączone z innymi ścieżkami tego nagrania: przesuwanie, dzielenie i przycinanie działają razem",
  ungroup: "Rozgrupuj",
  ungroupTip: "Edytuj osobno ekran, kamerę i dźwięk tego nagrania",
  cameraLayout: "Układ kamery",
  layoutCornerCircle: "Koło w rogu",
  layoutCornerRounded: "Zaokrąglony w rogu",
  layoutSplit: "Obok siebie",
  layoutCameraFull: "Tylko kamera",
  layoutHidden: "Ukryta",
  /** 当前布局对不上任何预设 */
  layoutCustom: "Własny",
  cameraLayoutNote: "Aby zmienić tylko fragment, najpierw podziel nagranie na obu końcach tego fragmentu.",
  presentation: "Prezentacja",
  presentationFull: "Pełny ekran",
  presentationInset: "Z marginesem",
  presentationNote: "Na marginesie widać kolor tła płótna.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "Ramka powiększenia",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `Powiększenie ${n}`,
};
