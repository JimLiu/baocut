import type { ScreenViewMessages } from './screen-view-copy.ts';

export const it: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "Inquadratura schermo",
  zooms: "Zoom",
  zoomsEmpty: "Ancora nessuno zoom. Trascina sulla riga Zoom della timeline per aggiungerne uno.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "Automatico",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "Automatico, modificato",
  zoomManual: "Manuale",
  /** 倍率 */
  amount: "Fattore",
  focus: "Fuoco",
  focusPointer: "Segui il mouse",
  focusPoint: "Punto fisso",
  focusPointNote: "Trascina la cornice sullo stage per scegliere dove guardare.",
  rampIn: "Transizione in entrata",
  rampOut: "Transizione in uscita",
  deleteZoom: "Elimina zoom",
  follow: "Inseguimento",
  safeArea: "Area sicura",
  smoothing: "Levigatura",
  regenerate: "Rigenera",
  regenerateTip: "Ricrea gli zoom automatici dai clic. Quelli modificati o aggiunti restano.",
  cursor: "Cursore",
  cursorSize: "Dimensione",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "Nascondi da fermo",
  clickRipple: "Evidenzia clic",
  cursorBaked: "Il cursore è registrato nell’immagine: non si può nascondere, ingrandire né cambiare.",
  cursorNone: "Questa registrazione non ha cursore.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "Zoom",
  mouseRow: "Mouse",
  zoomRowTip: "Trascina su uno spazio vuoto per aggiungere uno zoom; trascina uno zoom o i bordi per cambiarlo",
  mouseRowTip: "Clic di questa registrazione. Fai clic sulla riga per regolare il cursore.",
  /** 鼠标行上一次点击的读屏名 */
  click: "Clic",
  /** 片段上的联动标记的提示 */
  linked: "Collegato alle altre tracce di questa registrazione: spostare, dividere e rifilare agiscono insieme",
  ungroup: "Separa",
  ungroupTip: "Montare separatamente schermo, videocamera e audio di questa registrazione",
  cameraLayout: "Layout videocamera",
  layoutCornerCircle: "Cerchio nell’angolo",
  layoutCornerRounded: "Arrotondato nell’angolo",
  layoutSplit: "Affiancati",
  layoutCameraFull: "Solo videocamera",
  layoutHidden: "Nascosta",
  /** 当前布局对不上任何预设 */
  layoutCustom: "Personalizzato",
  cameraLayoutNote: "Per cambiare solo una parte, dividi prima la registrazione ai due estremi di quella parte.",
  presentation: "Presentazione",
  presentationFull: "Schermo intero",
  presentationInset: "Con margine",
  presentationNote: "Il margine mostra il colore di sfondo della tela.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "Cornice dello zoom",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `Zoom ${n}`,
};
