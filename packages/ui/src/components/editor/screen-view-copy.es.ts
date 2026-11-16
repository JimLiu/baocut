import type { ScreenViewMessages } from './screen-view-copy.ts';

export const es: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "Encuadre de pantalla",
  zooms: "Zooms",
  zoomsEmpty: "Aún no hay zooms. Arrastra en la fila Zoom de la línea de tiempo para añadir uno.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "Automático",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "Automático, editado",
  zoomManual: "Manual",
  /** 倍率 */
  amount: "Cantidad",
  focus: "Enfocar",
  focusPointer: "Seguir el ratón",
  focusPoint: "Punto fijo",
  focusPointNote: "Arrastra el marco en el escenario para elegir dónde enfocar.",
  rampIn: "Transición de entrada",
  rampOut: "Transición de salida",
  deleteZoom: "Eliminar zoom",
  follow: "Seguimiento",
  safeArea: "Zona segura",
  smoothing: "Suavizado",
  regenerate: "Regenerar",
  regenerateTip: "Vuelve a crear los zooms automáticos a partir de los clics. Los que cambiaste o añadiste se mantienen.",
  cursor: "Cursor",
  cursorSize: "Tamaño",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "Ocultar en reposo",
  clickRipple: "Resaltar clics",
  cursorBaked: "El cursor quedó grabado en la imagen, así que no se puede ocultar, ampliar ni cambiar.",
  cursorNone: "Esta grabación no tiene cursor.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "Zoom",
  mouseRow: "Ratón",
  zoomRowTip: "Arrastra en un hueco para añadir un zoom; arrastra un zoom o sus bordes para cambiarlo",
  mouseRowTip: "Clics de esta grabación. Haz clic en la fila para ajustar el cursor.",
  /** 鼠标行上一次点击的读屏名 */
  click: "Clic",
  /** 片段上的联动标记的提示 */
  linked: "Vinculado con las demás pistas de esta grabación: mover, dividir y recortar las afecta a la vez",
  ungroup: "Desagrupar",
  ungroupTip: "Editar pantalla, cámara y sonido por separado",
  cameraLayout: "Diseño de cámara",
  layoutCornerCircle: "Círculo en la esquina",
  layoutCornerRounded: "Redondeado en la esquina",
  layoutSplit: "Lado a lado",
  layoutCameraFull: "Solo cámara",
  layoutHidden: "Oculta",
  /** 当前布局对不上任何预设 */
  layoutCustom: "Personalizado",
  cameraLayoutNote: "Para cambiar solo una parte, divide primero la grabación en ambos extremos de esa parte.",
  presentation: "Presentación",
  presentationFull: "Pantalla completa",
  presentationInset: "Con margen",
  presentationNote: "El margen muestra el color de fondo del lienzo.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "Encuadre del zoom",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `Zoom ${n}`,
};
