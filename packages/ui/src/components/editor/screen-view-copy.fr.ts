import type { ScreenViewMessages } from './screen-view-copy.ts';

export const fr: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "Cadrage de l’écran",
  zooms: "Zooms",
  zoomsEmpty: "Aucun zoom pour l’instant. Faites glisser sur la ligne Zoom de la timeline pour en ajouter un.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "Auto",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "Auto, modifié",
  zoomManual: "Manuel",
  /** 倍率 */
  amount: "Facteur",
  focus: "Cible",
  focusPointer: "Suivre la souris",
  focusPoint: "Point fixe",
  focusPointNote: "Faites glisser le cadre sur la scène pour choisir la cible.",
  rampIn: "Transition d’entrée",
  rampOut: "Transition de sortie",
  deleteZoom: "Supprimer le zoom",
  follow: "Suivi",
  safeArea: "Zone sûre",
  smoothing: "Lissage",
  regenerate: "Régénérer",
  regenerateTip: "Recrée les zooms automatiques à partir des clics. Ceux que vous avez modifiés ou ajoutés restent.",
  cursor: "Curseur",
  cursorSize: "Taille",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "Masquer à l’arrêt",
  clickRipple: "Mettre en évidence les clics",
  cursorBaked: "Le curseur est incrusté dans l’image : impossible de le masquer, l’agrandir ou le modifier.",
  cursorNone: "Cet enregistrement n’a pas de curseur.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "Zoom",
  mouseRow: "Souris",
  zoomRowTip: "Glissez sur un espace vide pour ajouter un zoom ; glissez un zoom ou ses bords pour le modifier",
  mouseRowTip: "Clics de cet enregistrement. Cliquez sur la ligne pour régler le curseur.",
  /** 鼠标行上一次点击的读屏名 */
  click: "Clic",
  /** 片段上的联动标记的提示 */
  linked: "Lié aux autres pistes de cet enregistrement : déplacer, scinder et rogner s’appliquent ensemble",
  ungroup: "Dissocier",
  ungroupTip: "Monter séparément l’écran, la caméra et le son de cet enregistrement",
  cameraLayout: "Disposition de la caméra",
  layoutCornerCircle: "Cercle dans le coin",
  layoutCornerRounded: "Arrondi dans le coin",
  layoutSplit: "Côte à côte",
  layoutCameraFull: "Caméra seule",
  layoutHidden: "Masquée",
  /** 当前布局对不上任何预设 */
  layoutCustom: "Personnalisé",
  cameraLayoutNote: "Pour ne changer qu’une partie, scindez d’abord l’enregistrement aux deux bouts de cette partie.",
  presentation: "Présentation",
  presentationFull: "Plein écran",
  presentationInset: "Avec marge",
  presentationNote: "La marge laisse voir la couleur de fond du canevas.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "Cadre du zoom",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `Zoom ${n}`,
};
