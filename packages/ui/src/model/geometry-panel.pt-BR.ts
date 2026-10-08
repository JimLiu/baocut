import type { GeometryPanelMessages } from './geometry-panel.ts';

export const ptBR: GeometryPanelMessages = {
  x: { left: "Da esquerda", center: "Deslocamento horizontal", right: "Da direita" },
  y: { top: "Do topo", middle: "Deslocamento vertical", bottom: "Da base" },
  pins: {
    'left top': "Canto superior esquerdo",
    'center top': "Centro da borda superior",
    'right top': "Canto superior direito",
    'left middle': "Centro da borda esquerda",
    'center middle': "Centro",
    'right middle': "Centro da borda direita",
    'left bottom': "Canto inferior esquerdo",
    'center bottom': "Centro da borda inferior",
    'right bottom': "Canto inferior direito",
  },
};
