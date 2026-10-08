import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const ptBR: TransitionPanelMessages = {
  slot: { in: "Entrada", out: "Saída" },
  choice: {
    none: "Nenhuma",
    dissolve: "Dissolução",
    wipe: "Varredura",
    slide: "Deslizar para dentro",
    zoom: "Zoom",
    'dip-to-color': "Dissolver para cor",
    push: "Empurrar",
  },
  direction: { right: "Direita", left: "Esquerda", down: "Baixo", up: "Cima" },
  easing: { linear: "Linear", 'ease-in': "Aceleração suave", 'ease-out': "Desaceleração suave", 'ease-in-out': "Aceleração e desaceleração suaves" },
};
