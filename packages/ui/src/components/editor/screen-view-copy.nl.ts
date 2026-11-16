import type { ScreenViewMessages } from './screen-view-copy.ts';

export const nl: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "Schermkader",
  zooms: "Zooms",
  zoomsEmpty: "Nog geen zooms. Sleep in de rij Zoom op de tijdlijn om er een toe te voegen.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "Automatisch",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "Automatisch, bewerkt",
  zoomManual: "Handmatig",
  /** 倍率 */
  amount: "Factor",
  focus: "Focus",
  focusPointer: "Muis volgen",
  focusPoint: "Vast punt",
  focusPointNote: "Sleep het kader op het podium om te kiezen waar je kijkt.",
  rampIn: "Inloop",
  rampOut: "Uitloop",
  deleteZoom: "Zoom verwijderen",
  follow: "Volgen",
  safeArea: "Veilige zone",
  smoothing: "Afvlakking",
  regenerate: "Opnieuw maken",
  regenerateTip: "Maakt de automatische zooms opnieuw uit de klikken. Gewijzigde of toegevoegde blijven.",
  cursor: "Cursor",
  cursorSize: "Grootte",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "Verbergen bij stilstand",
  clickRipple: "Klikken markeren",
  cursorBaked: "De cursor is in het beeld opgenomen en kan niet verborgen, vergroot of aangepast worden.",
  cursorNone: "Deze opname heeft geen cursor.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "Zoom",
  mouseRow: "Muis",
  zoomRowTip: "Sleep op een lege plek om een zoom toe te voegen; sleep een zoom of de randen om hem te wijzigen",
  mouseRowTip: "Klikken in deze opname. Klik op de rij om de cursor in te stellen.",
  /** 鼠标行上一次点击的读屏名 */
  click: "Klik",
  /** 片段上的联动标记的提示 */
  linked: "Gekoppeld aan de andere sporen van deze opname: verplaatsen, splitsen en inkorten gebeuren samen",
  ungroup: "Groep opheffen",
  ungroupTip: "Scherm, camera en geluid van deze opname apart bewerken",
  cameraLayout: "Camera-indeling",
  layoutCornerCircle: "Cirkel in de hoek",
  layoutCornerRounded: "Afgerond in de hoek",
  layoutSplit: "Naast elkaar",
  layoutCameraFull: "Alleen camera",
  layoutHidden: "Verborgen",
  /** 当前布局对不上任何预设 */
  layoutCustom: "Aangepast",
  cameraLayoutNote: "Om alleen een deel te wijzigen, splits je de opname eerst aan beide kanten van dat deel.",
  presentation: "Weergave",
  presentationFull: "Volledig scherm",
  presentationInset: "Met rand",
  presentationNote: "In de rand zie je de achtergrondkleur van het canvas.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "Zoomkader",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `Zoom ${n}`,
};
