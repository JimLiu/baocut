import type { ScreenViewMessages } from './screen-view-copy.ts';

export const ptBR: ScreenViewMessages = {
  /** 检查器一节的标题 */
  section: "Enquadramento da tela",
  zooms: "Zooms",
  zoomsEmpty: "Ainda não há zooms. Arraste na linha Zoom da linha do tempo para adicionar um.",
  /** 自动生成、没改过的区间 */
  zoomAuto: "Automático",
  /** 自动生成之后改过的区间（重新生成时保留） */
  zoomEdited: "Automático, editado",
  zoomManual: "Manual",
  /** 倍率 */
  amount: "Fator",
  focus: "Foco",
  focusPointer: "Seguir o mouse",
  focusPoint: "Ponto fixo",
  focusPointNote: "Arraste o quadro no palco para escolher o foco.",
  rampIn: "Transição de entrada",
  rampOut: "Transição de saída",
  deleteZoom: "Excluir zoom",
  follow: "Acompanhamento",
  safeArea: "Área segura",
  smoothing: "Suavização",
  regenerate: "Gerar de novo",
  regenerateTip: "Recria os zooms automáticos a partir dos cliques. Os que você alterou ou adicionou ficam.",
  cursor: "Cursor",
  cursorSize: "Tamanho",
  /** 静止超过这么久就隐去（秒，0 是不隐去） */
  idleHide: "Ocultar quando parado",
  clickRipple: "Destacar cliques",
  cursorBaked: "O cursor foi gravado na imagem, então não dá para ocultar, ampliar nem mudar.",
  cursorNone: "Esta gravação não tem cursor.",
  /** 时间线上屏幕实例的附属行 */
  zoomRow: "Zoom",
  mouseRow: "Mouse",
  zoomRowTip: "Arraste num espaço vazio para adicionar um zoom; arraste um zoom ou as bordas para mudar",
  mouseRowTip: "Cliques desta gravação. Clique na linha para ajustar o cursor.",
  /** 鼠标行上一次点击的读屏名 */
  click: "Clique",
  /** 片段上的联动标记的提示 */
  linked: "Vinculado às outras faixas desta gravação: mover, dividir e aparar afetam todas juntas",
  ungroup: "Desagrupar",
  ungroupTip: "Editar separadamente a tela, a câmera e o som desta gravação",
  cameraLayout: "Layout da câmera",
  layoutCornerCircle: "Círculo no canto",
  layoutCornerRounded: "Arredondado no canto",
  layoutSplit: "Lado a lado",
  layoutCameraFull: "Só a câmera",
  layoutHidden: "Oculta",
  /** 当前布局对不上任何预设 */
  layoutCustom: "Personalizado",
  cameraLayoutNote: "Para mudar só uma parte, divida antes a gravação nas duas pontas dessa parte.",
  presentation: "Apresentação",
  presentationFull: "Tela cheia",
  presentationInset: "Com margem",
  presentationNote: "A margem mostra a cor de fundo da tela.",
  /** 舞台上固定焦点的取景框（读屏名） */
  framingBox: "Quadro do zoom",
  /** 列表里一段缩放的名字 */
  zoomName: (n: number) => `Zoom ${n}`,
};
